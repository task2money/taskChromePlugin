/**
 * Background Service Worker
 * 功能：
 *  - 顶层注册 webRequest 监听器，自动捕获错误响应
 *  - 将错误请求暂存到 chrome.storage
 *  - 作为 DevTools panel 与 popup 之间的消息桥梁
 */

importScripts(
  '../lib/storage.js',
  '../lib/create-task-git-identity.js',
  '../lib/create-task-payload.js',
  '../lib/client-public-ip.js',
  '../lib/api.js',
  '../lib/capture-status.js',
  '../lib/captured-entries.js',
  '../lib/captured-buffer.js',
  '../lib/element-picker.js',
  '../lib/async-timeout.js',
  '../lib/login-finalize.js',
  '../lib/multi-account.js',
  '../lib/oauth-pkce.js',
  '../lib/request-body-cache.js',
);

// ---- 捕获配置内存缓存（OPT-20260808-023 F1）----
// 热路径（webRequest onCompleted/onErrorOccurred）原本对 <all_urls> 的每个请求
// 都执行一次 chrome.storage.local.get IPC——storage 服务是浏览器进程内跨页面共享的
// 资源，轮询密集页 × 多标签页下队列饱和会阻塞所有依赖 storage 的调用方。
// 首读后缓存；双失效点：1) setCaptureEnabled 主动失效；2) storage.onChanged 兜底
// 失效（覆盖 Popup 等外部写入路径）。
let captureCfgCache = null;

async function getCaptureConfigCached() {
  if (captureCfgCache) return captureCfgCache;
  captureCfgCache = await Storage.getCaptureConfig();
  return captureCfgCache;
}

function invalidateCaptureConfigCache() {
  captureCfgCache = null;
}

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.captureEnabled || changes.captureStatusCodes) {
      invalidateCaptureConfigCache();
    }
  });
}

// ---- 顶层注册 webRequest 监听器 (MV3 最佳实践) ----

chrome.webRequest.onCompleted.addListener(
  handleRequestCompleted,
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// Canceled / 中止请求不会触发 onCompleted，需监听 onErrorOccurred
chrome.webRequest.onErrorOccurred.addListener(
  handleRequestError,
  { urls: ['<all_urls>'] }
);

// POST/PUT 请求体：HAR 常省略 postData；用 onBeforeRequest + requestBody 短时缓存补齐。
// 禁止把完整 body 打进日志。MV3 必须顶层注册，否则 SW 休眠会漏捕。
const requestBodyCache = (typeof createRequestBodyCache === 'function')
  ? createRequestBodyCache({ ttlMs: 5 * 60 * 1000, maxEntries: 200 })
  : { put() {}, lookup() { return ''; } };

if (typeof chrome.webRequest?.onBeforeRequest?.addListener === 'function') {
  chrome.webRequest.onBeforeRequest.addListener(
    function captureRequestBody(details) {
      if (!details || details.tabId < 0) return;
      const body = (typeof decodeWebRequestBody === 'function')
        ? decodeWebRequestBody(details.requestBody)
        : '';
      if (!body) return;
      requestBodyCache.put({
        method: details.method,
        url: details.url,
        tabId: details.tabId,
        timeStamp: details.timeStamp,
        requestId: details.requestId,
        body,
      });
    },
    { urls: ['<all_urls>'] },
    ['requestBody']
  );
}

// 5xx per-tab badge counters — Map<tabId, count>
const tab5xxCounts = new Map();
let activeTabId = -1;

// Track active tab changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  updateBadgeForActiveTab();
});

// Track tab closes — clean up
chrome.tabs.onRemoved.addListener((tabId) => {
  tab5xxCounts.delete(tabId);
  tabUrlCache.delete(tabId);
});

// OPT-20260808-023 F4: Memory Saver（Chrome 96+）discard 的标签页不触发 onRemoved，
// 但页面已冻结，Map 条目须在 discard 时同步清理（避免残留 + 卡死页不参与广播目标）
if (typeof chrome.tabs?.onDiscarded?.addListener === 'function') {
  chrome.tabs.onDiscarded.addListener((tabId) => {
    tab5xxCounts.delete(tabId);
    tabUrlCache.delete(tabId);
  });
}

// 跟踪 tab URL 变化 — 检测页面刷新/导航
const tabUrlCache = new Map();

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  const prevUrl = tabUrlCache.get(tabId);
  tabUrlCache.set(tabId, changeInfo.url);
  if (!prevUrl) return;
  if (prevUrl === changeInfo.url) return;

  const trackingCfg = await Storage.getTrackingConfig();
  if (!trackingCfg.enabled) {
    // 清空存储同时丢弃合批缓冲中未写入的条目，避免下一轮 flush 回写
    capturedBuffer.discard();
    await Storage.clearCapturedErrors();
    if (activeTabId === tabId) {
      tab5xxCounts.set(tabId, 0);
      updateBadgeForActiveTab();
    }
  }
});

async function updateBadgeForActiveTab() {
  const count = tab5xxCounts.get(activeTabId) || 0;
  if (count > 0) {
    await chrome.action.setBadgeText({ text: String(count) });
    await chrome.action.setBadgeBackgroundColor({ color: '#f38ba8' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

/** 5xx 徽标更新去抖（500ms 合批）— 轮询密集型页面每请求一次 chrome.action 是多余开销 */
let badgeUpdateTimer = null;
function scheduleBadgeUpdate() {
  if (badgeUpdateTimer) return;
  badgeUpdateTimer = setTimeout(() => {
    badgeUpdateTimer = null;
    updateBadgeForActiveTab();
  }, 500);
}

/**
 * 处理完成的请求 — 按 tab 隔离计数，按 capture 配置存储详情
 * （OPT-20260808-019：条目入合批缓冲，1s 节流批量写入，见 capturedBuffer）
 */
async function handleRequestCompleted(details) {
  try {
    const tabId = details.tabId;
    if (tabId < 0) return;

    // 角标示数仅计 5xx（与捕获配置无关；4xx/Canceled 不计入）
    if (CaptureStatus.isHttp5xx(details.statusCode)) {
      const prev = tab5xxCounts.get(tabId) || 0;
      tab5xxCounts.set(tabId, prev + 1);
      if (tabId === activeTabId) {
        scheduleBadgeUpdate();
      }
    }

    const captureCfg = await getCaptureConfigCached();
    if (!captureCfg.enabled) return;

    const isError = CaptureStatus.matchStatusCode(details.statusCode, captureCfg.statusCodes, { canceled: false });
    if (!isError) return;

    const entry = CapturedEntries.buildCapturedEntry({
      url: details.url,
      method: details.method,
      statusCode: details.statusCode,
      statusLine: details.statusLine || '',
      type: details.type,
      timeStamp: details.timeStamp,
      tabId,
      requestHeaders: extractHeaders(details.requestHeaders),
      responseHeaders: extractHeaders(details.responseHeaders),
      canceled: false,
      error: '',
    });

    capturedBuffer.push(entry);
  } catch (_) {
    // 静默处理 storage 读取失败
  }
}

/**
 * 处理 Canceled / 网络错误请求 — webRequest.onCompleted 不会触发
 */
async function handleRequestError(details) {
  try {
    if (details.error !== 'net::ERR_ABORTED') return;

    const tabId = details.tabId;
    if (tabId < 0) return;

    const captureCfg = await getCaptureConfigCached();
    if (!captureCfg.enabled) return;

    const canceled = true;
    const statusCode = 0;
    const statusLine = 'Canceled';

    const isMatch = CaptureStatus.matchStatusCode(statusCode, captureCfg.statusCodes, { canceled });
    if (!isMatch) return;

    const entry = CapturedEntries.buildCapturedEntry({
      url: details.url,
      method: details.method,
      statusCode,
      statusLine,
      type: details.type,
      timeStamp: details.timeStamp,
      tabId,
      requestHeaders: {},
      responseHeaders: {},
      canceled,
      error: details.error || '',
    });

    capturedBuffer.push(entry);
  } catch (_) {
    // 静默处理 storage 读取失败
  }
}

function extractHeaders(headers) {
  if (!headers) return {};
  const obj = {};
  for (const h of headers) {
    obj[h.name] = h.value;
  }
  return obj;
}

async function enrichTaskDataWithOwner(taskData) {
  if (!taskData || taskData.owner) return taskData;
  const mapping = await Storage.getEndpointMapping();
  if (mapping?.owner) {
    return { ...taskData, owner: String(mapping.owner) };
  }
  const cred = await Storage.getCredentials();
  if (cred.memberId) {
    return { ...taskData, owner: String(cred.memberId) };
  }
  return taskData;
}

function applyEndpointOwner(mapping) {
  if (mapping?.owner) {
    API.setOwner(mapping.owner);
  }
}

/**
 * 从消息或 storage 初始化 API（content script 可不传 baseUrl/token）
 */
async function initApiFromMessage(message = {}) {
  const cfg = await Storage.getApiConfig();
  const mapping = message.endpointMapping != null
    ? message.endpointMapping
    : await Storage.getEndpointMapping();
  const cred = await Storage.getCredentials();
  const baseUrl = message.baseUrl || cfg.baseUrl;
  const token = message.token || cfg.token;
  API.init(baseUrl, token, mapping, cred.userId || '');
  if (cred.userId) API.setUserId(cred.userId);
  applyEndpointOwner(mapping);
  return { baseUrl, token, mapping, cred, cfg };
}

/** 单标签/子 frame 消息超时：discarded/frozen 页上 sendMessage 可能永不 resolve */
const AUTH_BROADCAST_TAB_TIMEOUT_MS = 800;

/** 登录成功：持久化（带超时），靠 chrome.storage.onChanged 通知各页，绝不扇出全部标签页 */
async function completeLoginAndRespond(baseUrl, token, expiresIn, username, userId, memberId, result) {
  // 先写入内存会话，保证即便 storage 短暂失败也能继续
  API.init(baseUrl, token, null, userId || '');
  if (memberId) API.setOwner(memberId);

  const persistOpts = {
    saveApiConfig: (url, tok, exp) => Storage.saveApiConfig(url, tok, exp),
    saveCredentials: (name, uid, mid) => Storage.saveCredentials(name, uid, mid),
    baseUrl,
    token,
    expiresIn,
    username,
    userId,
    memberId,
    withTimeout,
    timeoutMs: 3000,
  };

  try {
    await finalizeLoginSuccess(persistOpts);
  } catch (e) {
    console.warn('[taskChromePlugin] 保存登录态失败/超时，后台重试:', e?.message || e);
    // 后台再试一次（无超时包装由 storage 自身决定）
    void persistLoginCredentials({ ...persistOpts, timeoutMs: 0 }).catch((err) => {
      console.warn('[taskChromePlugin] 登录态后台重试仍失败:', err?.message || err);
    });
  }
  return { success: true, data: result };
}

// OPT-20260808-024：旧登录（密码/访问令牌/Cookie 桥接）已移除。
// 登录态只经 OAuth2+PKCE 授权码流程获得（case 'oauthStart' / 'oauthCallback'）。

// ---- 捕获条目合批缓冲（OPT-20260808-019）----
// 每个请求只入内存队列，1s 节流批量写入 session storage。
// 修复前：每个请求都做一次「读 500 条数组 → push → 全量写回」，
// work-panel 等轮询密集页面每分钟数十次请求 → 每次 1MB+ JSON parse/stringify
// 写风暴 + storage.onChanged 广播风暴。修复后每请求零 storage 读写，
// 至多每秒一次批量写（Storage.addCapturedErrors 内部仍有 500 条上限）。
const capturedBuffer = CapturedBuffer.createCapturedBuffer({
  flush: (batch) => Storage.addCapturedErrors(batch),
  flushIntervalMs: 1000,
  maxEntries: 500,
});

// ---- 内存中的请求缓存 (DevTools 转发) ----

let devToolsRequests = [];
const MAX_DEVTOOLS_REQUESTS = 500;

// ---- 消息处理 ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('[taskChromePlugin] handleMessage 异常:', err);
      sendResponse({ success: false, error: err?.message || '内部错误' });
    });
  return true;
});

async function handleMessage(message, sender) {
  switch (message.action) {
    case 'ping':
      return { pong: true };

    case 'resetBadge':
      tab5xxCounts.set(activeTabId, 0);
      updateBadgeForActiveTab();
      return { success: true };

    case 'checkTokenStatus':
      return {
        success: true,
        data: {
          expired: await Storage.isTokenExpired(),
          remainingSeconds: await Storage.getTokenRemainingSeconds(),
        },
      };

    case 'getAuthStatus':
      {
        await Storage.migrateStaleTokenExpiryOnce();
        let cfg = await Storage.getApiConfig();
        let cred = await Storage.getCredentials();
        let expired = cfg.token ? await Storage.isTokenExpired() : false;

        const remainingSeconds = await Storage.getTokenRemainingSeconds();
        return {
          success: true,
          data: {
            ...cfg,
            username: cred.username || '',
            userId: cred.userId || '',
            memberId: cred.memberId || '',
            expired,
            loggedIn: !!(cfg.token && !expired),
            remainingSeconds,
            expiryHint: Storage.formatTokenExpiryHint(remainingSeconds),
          },
        };
      }

    // ---- 请求追踪 ----

    case 'addRecentRequest':
      devToolsRequests.push(message.request);
      if (devToolsRequests.length > MAX_DEVTOOLS_REQUESTS) {
        devToolsRequests.splice(0, devToolsRequests.length - MAX_DEVTOOLS_REQUESTS);
      }
      return { success: true };

    case 'updateRecentRequest':
      {
        const req = message.request;
        if (!req?.id) return { success: false, error: 'missing request id' };
        const idx = devToolsRequests.findIndex((r) => r.id === req.id);
        if (idx >= 0) {
          devToolsRequests[idx] = req;
        } else {
          devToolsRequests.push(req);
          if (devToolsRequests.length > MAX_DEVTOOLS_REQUESTS) {
            devToolsRequests.splice(0, devToolsRequests.length - MAX_DEVTOOLS_REQUESTS);
          }
        }
        return { success: true };
      }

    case 'getRecentRequests':
      {
        let list = [...devToolsRequests];
        if (message.filter?.errorsOnly) {
          // 与插件角标示数一致：仅 5xx
          list = CaptureStatus.filterBadgeCountableRequests(list);
        }
        list.sort((a, b) => b.timestamp - a.timestamp);
        return { success: true, data: list.slice(0, message.limit || 50) };
      }

    case 'clearRecentRequests':
      // 面板「🗑️ 清空列表」：仅清空 DevTools 转发的内存缓存。
      // seenHarKeys 由 DevTools 页保留，避免 HAR 补录把已清条目重新加回。
      devToolsRequests = [];
      return { success: true };

    case 'updateApiConfig':
      API.init(message.baseUrl, message.token);
      await Storage.saveApiConfig(message.baseUrl, message.token);
      return { success: true };

    // ---- 登录（OAuth2+PKCE，OPT-20260808-024）----
    // 旧密码/访问令牌/Cookie 桥接登录已移除；登录入口为 oauthStart → oauthCallback。
    // PKCE 会话（verifier/state）仅存扩展 storage 5 分钟，回调页凭 state 取回校验。

    case 'oauthStart':
      {
        const baseUrl = String(message.baseUrl || '').trim();
        if (!baseUrl) return { success: false, error: '缺少服务器地址' };
        try {
          const verifier = OAuthPKCE.generateCodeVerifier();
          const codeChallenge = await OAuthPKCE.generateCodeChallenge(verifier);
          const state = OAuthPKCE.generateState();
          const session = {
            verifier,
            state,
            baseUrl,
            createdAt: Date.now(),
          };
          await chrome.storage.local.set({ oauthPkceSession: session });
          const authorizeUrl = OAuthPKCE.buildAuthorizeUrl({
            baseUrl,
            extensionId: chrome.runtime.id,
            state,
            codeChallenge,
          });
          await chrome.tabs.create({ url: authorizeUrl });
          return { success: true };
        } catch (e) {
          console.warn('[taskChromePlugin] oauthStart 失败:', e?.message || e);
          return { success: false, error: e?.message || '无法打开授权页' };
        }
      }

    case 'oauthCallback':
      {
        const { code, state } = message;
        try {
          const stored = await chrome.storage.local.get('oauthPkceSession');
          const session = stored && stored.oauthPkceSession;
          // state 校验（防 CSRF）与 TTL（5 分钟）——与 lib/oauth-callback.js 同规则
          if (!session || session.state !== state) {
            return { success: false, error: 'state 校验失败，请重新登录' };
          }
          if (session.createdAt && Date.now() - session.createdAt > 5 * 60 * 1000) {
            return { success: false, error: '登录会话已过期，请重新登录' };
          }

          const redirectUri = `chrome-extension://${chrome.runtime.id}${OAuthPKCE.REDIRECT_PATH}`;
          const tokenRes = await OAuthPKCE.exchangeCodeForToken({
            baseUrl: session.baseUrl,
            code,
            redirectUri,
            codeVerifier: session.verifier,
          });
          const accessToken = tokenRes.access_token;
          if (!accessToken) return { success: false, error: 'OAuth token 交换未返回 access_token' };

          const userInfo = await OAuthPKCE.fetchUserInfo(session.baseUrl, accessToken);
          const username = userInfo.preferred_username || userInfo.name || userInfo.email || userInfo.sub || '';
          const userId = userInfo.sub || '';

          // 单账号语义（OPT-20260806-036）：只写 apiConfig + credentials，不占 savedAccounts 槽位
          const result = await completeLoginAndRespond(
            session.baseUrl,
            accessToken,
            tokenRes.expires_in || 3600,
            username,
            userId,
            '',
            { user: userInfo },
          );

          await chrome.storage.local.remove('oauthPkceSession');

          // 关闭回调页（登录成功后自动收尾；失败页保留展示错误）
          const tabId = message.tabId || (sender && sender.tab && sender.tab.id);
          if (typeof tabId === 'number') {
            setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), 1500);
          }
          return result;
        } catch (e) {
          console.warn('[taskChromePlugin] oauthCallback 失败:', e?.message || e);
          return { success: false, error: e?.message || 'OAuth 登录处理失败', traceId: e?.traceId || '' };
        }
      }

    case 'logout':
      try {
        await Storage.clearAuth();
        API.clearSession();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    // ---- 工作空间/项目/成员 ----

    case 'getWorkspaces':
      try {
        await initApiFromMessage(message);
        const data = await API.getWorkspaces(message.companyId);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'getProjects':
      try {
        await initApiFromMessage(message);
        const data = await API.getProjects(message.workspaceId, message.companyId);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'getMembers':
      try {
        await initApiFromMessage(message);
        // OPT-20260820-040: workspaceId 存在时走 workspace-collaborators（普通成员可见）
        const data = await API.getMembers(message.companyId, message.workspaceId);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'fetchProgressColumns':
      try {
        await initApiFromMessage(message);
        const data = await API.fetchProgressColumns(message.companyId, message.workspaceId);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'getBranches':
      try {
        await initApiFromMessage(message);
        const data = await API.getBranches(message.companyId, message.projectId, message.repoUrl);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'getDeliverableTypes':
      try {
        await initApiFromMessage(message);
        const data = await API.getDeliverableTypes(message.companyId, message.workspaceId);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'getInstalledImages':
      try {
        await initApiFromMessage(message);
        const data = await API.getInstalledImages(message.companyId);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'getPersonalFeatureParamsConfigs':
      try {
        await initApiFromMessage(message);
        const data = await API.getPersonalFeatureParamsConfigs();
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'listGitIdentities':
      try {
        await initApiFromMessage(message);
        const uid = API.getUserId();
        if (!uid) throw new Error('缺少 userId');
        const path = CreateTaskGitIdentity.gitIdentitiesRequestPath(uid, message.companyId);
        const data = await API.request('GET', path);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'resolveAidevMeta':
      try {
        await initApiFromMessage(message);
        const data = await API.resolveAidevMeta({
          serviceId: message.serviceId,
          tag: message.tag,
        });
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    // ---- 任务创建 ----

    case 'createTask':
      try {
        await initApiFromMessage(message);
        const taskData = await enrichTaskDataWithOwner(message.taskData);
        const data = await API.createTask(taskData);
        await Storage.addTaskHistory({
          type: 'single',
          title: taskData?.title || '(无标题)',
          workspaceId: taskData?.workspaceId || taskData?.workspace_id,
          projectIds: taskData?.projectIds || taskData?.projects,
          status: 'success',
          resultId: data?.id || data?._id,
          taskData,
          response: data,
        });
        return { success: true, data };
      } catch (e) {
        await Storage.addTaskHistory({
          type: 'single',
          title: message.taskData?.title || '(无标题)',
          workspaceId: message.taskData?.workspaceId,
          projectIds: message.taskData?.projectIds,
          status: 'failed',
          error: e.message,
          taskData: message.taskData,
        });
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'createTasksBatch':
      try {
        await initApiFromMessage(message);
        const tasksData = [];
        for (const task of message.tasksData || []) {
          tasksData.push(await enrichTaskDataWithOwner(task));
        }
        const data = await API.createTasksBatch(tasksData);
        const tasksArr = Array.isArray(message.tasksData) ? message.tasksData : [];
        const hasErrors = data.errors && data.errors.length > 0;
        await Storage.addTaskHistory({
          type: 'batch',
          title: `批量创建 ${data.total} 个任务`,
          workspaceId: tasksArr[0]?.workspaceId || tasksArr[0]?.workspace_id,
          projectIds: tasksArr[0]?.projectIds || tasksArr[0]?.projects,
          count: data.total,
          status: hasErrors ? 'partial' : 'success',
          resultId: `${data.succeeded}/${data.total}`,
          response: data,
        });
        if (hasErrors) {
          return { success: true, data, warning: data.errors.map(e => `${e.task}: ${e.error}`).join('; ') };
        }
        return { success: true, data };
      } catch (e) {
        const tasksArr = Array.isArray(message.tasksData) ? message.tasksData : [];
        await Storage.addTaskHistory({
          type: 'batch',
          title: `批量创建 ${tasksArr.length} 个任务`,
          workspaceId: tasksArr[0]?.workspaceId || tasksArr[0]?.workspace_id,
          projectIds: tasksArr[0]?.projectIds || tasksArr[0]?.projects,
          count: tasksArr.length,
          status: 'failed',
          error: e.message,
          tasksData: tasksArr,
        });
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    // ---- 捕获、存储、配置 ----

    case 'setCaptureEnabled':
      if (message.enabled) {
        await Storage.saveCaptureConfig(true, message.statusCodes || ['2xx', '3xx', '4xx', '5xx', 'canceled']);
      } else {
        await Storage.saveCaptureConfig(false, message.statusCodes || ['2xx', '3xx', '4xx', '5xx', 'canceled']);
      }
      // 缓存主动失效（storage.onChanged 兜底已覆盖外部写入路径）
      invalidateCaptureConfigCache();
      return { success: true };

    case 'getCapturedErrors':
      return { success: true, data: await Storage.getCapturedErrors() };

    case 'clearCapturedErrors':
      // 丢弃缓冲中的 pending 条目，避免下一轮 flush 把「已清空」的数据回写
      capturedBuffer.discard();
      await Storage.clearCapturedErrors();
      return { success: true };

    case 'getApiConfig':
      return { success: true, data: await Storage.getApiConfig() };

    case 'getCaptureConfig':
      return { success: true, data: await Storage.getCaptureConfig() };

    case 'getTrackingConfig':
      return { success: true, data: await Storage.getTrackingConfig() };

    case 'setTrackingConfig':
      await Storage.saveTrackingConfig(message.enabled);
      return { success: true };

    case 'setElementPickerShortcut':
      return await applyElementPickerShortcut(message.shortcut);

    case 'getElementPickerShortcutStatus':
      return await getElementPickerShortcutStatus();

    case 'getTaskHistory':
      return { success: true, data: await Storage.getTaskHistory() };

    case 'addTaskHistory':
      await Storage.addTaskHistory(message.entry);
      return { success: true };

    case 'clearTaskHistory':
      await Storage.clearTaskHistory();
      return { success: true };

    case 'getFailedTasks':
      return { success: true, data: await Storage.getFailedTasks() };

    case 'getEndpointMapping':
      return { success: true, data: await Storage.getEndpointMapping() };

    case 'saveEndpointMapping':
      await Storage.saveEndpointMapping(message.mapping);
      API.setEndpointMapping(message.mapping);
      if (message.mapping.owner) {
        API.setOwner(message.mapping.owner);
      }
      return { success: true };

    case 'getFloatBallConfig':
      try {
        return { success: true, data: await Storage.getFloatBallConfig() };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'saveFloatBallConfig':
      try {
        await Storage.saveFloatBallConfig(message.enabled);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'getFloatBallPosition':
      try {
        return { success: true, data: await Storage.getFloatBallPosition() };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'saveFloatBallPosition':
      try {
        await Storage.saveFloatBallPosition(message.x, message.y);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'startElementPick':
      {
        const tabId = message.tabId || sender?.tab?.id;
        if (!tabId) return { success: false, error: '缺少 tabId，无法启动元素选择' };
        try {
          const resp = await chrome.tabs.sendMessage(tabId, {
            action: 'startElementPick',
            source: message.source || 'devtools',
          }, { frameId: 0 });
          await broadcastPickToChildFrames(tabId, 'startElementPick', message.source || 'devtools');
          console.log('[taskChromePlugin] startElementPick forwarded to tab', tabId);
          return resp?.success ? { success: true } : { success: false, error: resp?.error || 'content script 未响应' };
        } catch (e) {
          return { success: false, error: e.message || '无法联系页面 content script（请刷新页面）' };
        }
      }

    case 'broadcastStartElementPick':
      {
        const tabId = sender?.tab?.id;
        if (!tabId) return { success: false, error: '缺少 tabId' };
        await broadcastPickToChildFrames(tabId, 'startElementPick', message.source || 'float');
        return { success: true };
      }

    case 'cancelElementPickBroadcast':
      {
        const tabId = sender?.tab?.id;
        if (!tabId) return { success: true };
        await broadcastPickToChildFrames(tabId, 'cancelElementPick');
        return { success: true };
      }

    // OPT-20260806-016: 子 frame 内页内兜底按键转发（跨域 iframe 按键不冒泡到
    // 顶层，content.js 的 keydown 兜底在子 frame 聚焦时不触发）。
    // 复用浏览器命令路径（frame0 优先、整 tab 广播回退），与去抖保护天然一致。
    case 'toggleElementPickShortcut':
      {
        const tabId = sender?.tab?.id;
        if (!tabId) return { success: false, error: '缺少 tabId' };
        await toggleElementPickInTab(tabId);
        return { success: true };
      }

    case 'elementPickedInFrame':
      {
        const tabId = sender?.tab?.id;
        if (!tabId) return { success: false, error: '缺少 tab' };
        try {
          const leafFrameId = sender.frameId != null ? sender.frameId : 0;
          let frames = [];
          try {
            frames = await chrome.webNavigation.getAllFrames({ tabId });
          } catch (e) {
            console.warn('[taskChromePlugin] getAllFrames for pick path failed:', e.message || e);
          }
          const framePath = (typeof ElementPicker !== 'undefined' && ElementPicker.buildFramePathFromRoot)
            ? ElementPicker.buildFramePathFromRoot(frames || [], leafFrameId)
            : [];
          const ancestorIframeRects = await collectAncestorIframeRects(tabId, framePath);
          await chrome.tabs.sendMessage(tabId, {
            action: 'elementPickedInFrame',
            snapshot: message.snapshot,
            rectInFrame: message.rectInFrame,
            frameUrl: message.frameUrl,
            framePath,
            ancestorIframeRects,
            leafFrameId,
          }, { frameId: 0 });
          console.log(
            '[taskChromePlugin] elementPickedInFrame forwarded to top frame, nest=',
            framePath.length,
          );
          return { success: true };
        } catch (e) {
          return { success: false, error: e.message || '转发到顶层失败' };
        }
      }

    case 'elementPickResult':
      {
        console.log('[taskChromePlugin] elementPickResult ack, blockLen=', String(message.block || '').length);
        return { success: true };
      }

    case 'captureElementScreenshot':
      {
        try {
          const tabId = sender?.tab?.id;
          if (tabId == null) return { success: false, error: '截图需要来自页面的请求' };
          const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
            format: 'jpeg',
            quality: 72,
          });
          const cropped = await cropCaptureToElement(
            dataUrl,
            message.rect,
            message.devicePixelRatio || 1,
            message.maxWidth || 400,
          );
          return { success: true, dataUrl: cropped };
        } catch (e) {
          console.error('[taskChromePlugin] captureElementScreenshot failed:', e);
          return { success: false, error: e.message || '截图失败', traceId: e.traceId || '' };
        }
      }

    case 'uploadPluginScreenshot':
      {
        try {
          if (!message.dataUrl) return { success: false, error: '缺少截图 dataUrl' };
          const cfg = await Storage.getApiConfig();
          const mapping = await Storage.getEndpointMapping();
          const cred = await Storage.getCredentials();
          if (!cfg.token) return { success: false, error: '请先登录后再上传截图' };
          API.init(cfg.baseUrl, cfg.token, mapping, cred.userId || '');
          const data = await API.uploadPluginScreenshot(message.dataUrl);
          const url = data?.url || data?.absolute_url;
          if (!url) throw new Error('上传响应缺少 url');
          console.log('[taskChromePlugin] uploadPluginScreenshot ok');
          return { success: true, url, data };
        } catch (e) {
          console.error('[taskChromePlugin] uploadPluginScreenshot failed:', e);
          return { success: false, error: e.message || '上传失败', traceId: e.traceId || '' };
        }
      }

    // ---- 多账号管理 (Multi-Account Bridge) ----

    case 'getSavedAccounts':
      {
        const list = await MultiAccount.listSavedAccounts();
        return { success: true, data: list };
      }

    case 'upsertSavedAccount':
      {
        const result = await MultiAccount.upsertSavedAccount(message);
        return { success: true, data: result };
      }

    case 'removeSavedAccount':
      {
        const result = await MultiAccount.removeSavedAccount(message.userId);
        return { success: true, data: result };
      }

    // OPT-20260806-056: 网页端主动清理过期/指定槽位（与 accountExpired 消费配套）
    case 'pruneSavedAccounts':
      {
        const userIds = Array.isArray(message.userIds) ? message.userIds : [];
        const result = await MultiAccount.pruneSavedAccounts(userIds);
        return { success: true, data: result };
      }

    case 'getActiveToken':
      {
        const token = await MultiAccount.getActiveToken();
        return { success: true, data: token };
      }

    case 'getActiveAccount':
      {
        const account = await MultiAccount.getActiveAccount();
        return { success: true, data: account };
      }

    case 'getCurrentUserId':
      {
        const userId = await MultiAccount.getActiveCurrentUserId();
        return { success: true, data: userId };
      }

    case 'switchAccount':
      {
        try {
          const account = await MultiAccount.setActiveUserId(message.userId);
          // 同步 token 到现有 API 模块，使后续 API 调用使用新账号
          API.init(
            undefined,        // 保持 baseUrl 不变
            account.token,
            undefined,        // 保持 endpointMapping
            account.userId,
          );
          await Storage.saveApiConfig('', account.token, 0);
          await Storage.saveCredentials(account.username, account.userId, '');
          return { success: true, data: account };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }

    case 'setActiveAccount':
      {
        try {
          const upsertResult = await MultiAccount.upsertSavedAccount(message);
          const account = await MultiAccount.setActiveUserId(upsertResult.upserted.userId);
          // 同步到现有 API/Storage 层
          API.init(undefined, account.token, undefined, account.userId);
          await Storage.saveApiConfig('', account.token, 0);
          await Storage.saveCredentials(account.username, account.userId, '');
          return { success: true, data: upsertResult };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }

    case 'clearSavedAccounts':
      {
        await MultiAccount.clearSavedAccounts();
        await Storage.clearAuth();
        API.init(undefined, '', undefined, '');
        return { success: true };
      }

    case 'lookupRequestBody':
      {
        const body = requestBodyCache.lookup({
          method: message.method,
          url: message.url,
          tabId: message.tabId,
          timestamp: message.timestamp,
          requestId: message.requestId,
        });
        return { success: true, body };
      }

    default:
      return { error: `Unknown action: ${message.action}` };
  }
}

/**
 * 向除顶层外的所有 frame 广播选元素指令。
 * OPT-20260808-023 F3：逐 frame 串行 await 会因任一子 frame 卡死拖住整个 SW 消息
 * 处理；改为并行 + withTimeout（≤800ms settle），卡死 frame 不再阻塞其余广播。
 */
async function broadcastPickToChildFrames(tabId, action, source) {
  let frames = [];
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch (e) {
    console.warn('[taskChromePlugin] getAllFrames failed:', e.message || e);
    return;
  }
  const targets = (frames || []).filter((f) => f && f.frameId !== 0);
  await Promise.allSettled(
    targets.map((f) => {
      const send = chrome.tabs.sendMessage(tabId, {
        action,
        source: source || 'float',
      }, { frameId: f.frameId }).catch(() => {});
      if (typeof withTimeout === 'function') {
        return withTimeout(send, AUTH_BROADCAST_TAB_TIMEOUT_MS, 'pick broadcast').catch(() => {});
      }
      return send;
    }),
  );
}

/**
 * 沿 framePath（近顶→leaf）向各父 frame 查询子 iframe 在父视口中的矩形
 */
async function collectAncestorIframeRects(tabId, framePath) {
  const path = Array.isArray(framePath) ? framePath : [];
  const rects = [];
  for (let i = 0; i < path.length; i++) {
    const child = path[i];
    const parentFrameId = i === 0 ? 0 : path[i - 1].frameId;
    try {
      const resp = await chrome.tabs.sendMessage(tabId, {
        action: 'locateChildFrameRect',
        childFrameUrl: child.url,
      }, { frameId: parentFrameId });
      if (resp?.success && resp.rect) {
        rects.push({
          left: resp.rect.left || 0,
          top: resp.rect.top || 0,
          width: resp.rect.width || 0,
          height: resp.rect.height || 0,
        });
      } else {
        rects.push({ left: 0, top: 0, width: 0, height: 0 });
      }
    } catch (_) {
      rects.push({ left: 0, top: 0, width: 0, height: 0 });
    }
  }
  return rects;
}

/**
 * 将整页截图裁剪为元素区域并缩放
 * @param {string} dataUrl
 * @param {{left:number,top:number,width:number,height:number}} rect CSS 像素
 * @param {number} dpr
 * @param {number} maxWidth
 */
async function cropCaptureToElement(dataUrl, rect, dpr, maxWidth) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
    throw new Error('无效的元素矩形');
  }
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const sx = Math.max(0, Math.round(rect.left * dpr));
  const sy = Math.max(0, Math.round(rect.top * dpr));
  const sw = Math.max(1, Math.round(rect.width * dpr));
  const sh = Math.max(1, Math.round(rect.height * dpr));
  const clampedW = Math.min(sw, bitmap.width - sx);
  const clampedH = Math.min(sh, bitmap.height - sy);
  if (clampedW <= 0 || clampedH <= 0) {
    bitmap.close?.();
    throw new Error('元素矩形超出截图范围');
  }
  const scale = clampedW > maxWidth ? maxWidth / clampedW : 1;
  const outW = Math.max(1, Math.round(clampedW * scale));
  const outH = Math.max(1, Math.round(clampedH * scale));
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 不可用');
  ctx.drawImage(bitmap, sx, sy, clampedW, clampedH, 0, 0, outW, outH);
  bitmap.close?.();
  const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.65 });
  const buffer = await outBlob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

// ---- 键盘快捷键命令 ----

// toggleElementPickInTab 向 tab 顶层 frame 发送切换消息，失败时回退整 tab 广播。
// 供两条路径复用：chrome.commands.onCommand（浏览器级命令）与子 frame 内
// 页内兜底转发（pick-frame.js 检测到按键后经 runtime message 到达，OPT-20260806-016）。
async function toggleElementPickInTab(tabId) {
  let resp;
  try {
    resp = await chrome.tabs.sendMessage(tabId, { action: 'toggleElementPick' }, { frameId: 0 });
  } catch (frame0Err) {
    // 顶层 frame 尚未注入 content script（受限页/刷新竞态）时，
    // 回退为整 tab 广播，保证快捷键在内容脚本注入后立即可用
    console.warn(
      '[taskChromePlugin] toggleElementPick frame0 失败，回退整 tab 广播:',
      frame0Err?.message || frame0Err,
    );
    resp = await chrome.tabs.sendMessage(tabId, { action: 'toggleElementPick' });
  }
  console.log(
    '[taskChromePlugin] toggleElementPick via shortcut:',
    resp?.success ? 'ok' : 'content script 未响应',
  );
}

// ---- 元素拾取快捷键动态改绑（chrome.commands.update，Chrome 110+）----
// 平台探测复用 Storage.isMacPlatform（chrome.commands.update 的修饰键规则按平台区分）

/**
 * 应用元素拾取快捷键（Popup「修改/恢复默认」统一入口）：
 * 1) 规范校验；2) chrome.commands.update 改绑浏览器级键位（冲突等错误原样返回给 Popup）；
 *    旧浏览器（< Chrome 110）降级为仅持久化 + 页内兜底生效；
 * 3) 持久化规范串。各页经 chrome.storage.onChanged 更新兜底监听，不向全部标签页 sendMessage。
 *    commands.update 的绑定由 Chrome 持久化，故无需在 SW 启动时重复改绑。
 */
async function applyElementPickerShortcut(shortcut) {
  const normalized = Storage.normalizeShortcut(shortcut);
  if (!normalized) {
    return { success: false, error: `非法快捷键组合: ${String(shortcut)}` };
  }
  const binding = Storage.shortcutToPlatformBinding(normalized, Storage.isMacPlatform());
  if (typeof chrome.commands?.update === 'function') {
    try {
      await chrome.commands.update({ name: 'toggle-element-picker', shortcut: binding });
    } catch (e) {
      // 常见原因：与其他扩展/浏览器命令冲突（"already in use by another extension"）
      const msg = e?.message || '快捷键绑定失败';
      console.warn('[taskChromePlugin] commands.update 失败:', msg);
      return { success: false, error: msg, shortcut: normalized };
    }
  } else {
    console.warn('[taskChromePlugin] chrome.commands.update 不可用（需 Chrome 110+），仅持久化 + 页内兜底生效');
  }
  await Storage.saveElementPickerShortcut(normalized);
  return { success: true, data: { shortcut: normalized } };
}

/**
 * OPT-20260806-048: 读取「配置的快捷键 vs 浏览器实际绑定」差异。
 * 用户可在 chrome://extensions/shortcuts 手动改绑（该绑定优先于配置、且插件
 * 内不可感知 — SW 设计上不做启动重绑，避免覆盖手动设置）；Popup 据此展示提示
 * 「浏览器实际绑定为 X，与配置 Y 不同，点此恢复」。
 * 旧浏览器（<Chrome 110，无 commands.update）无 commands API 时返回 null 绑定。
 */
async function getElementPickerShortcutStatus() {
  const configured = await Storage.getElementPickerShortcut();
  let actual = null;
  if (typeof chrome.commands?.getAll === 'function') {
    try {
      const commands = await chrome.commands.getAll();
      const found = (commands || []).find((c) => c.name === 'toggle-element-picker');
      actual = found?.shortcut || '';
    } catch (e) {
      console.warn('[taskChromePlugin] commands.getAll 失败:', e.message || e);
      actual = null;
    }
  }
  const binding = Storage.shortcutToPlatformBinding(configured, Storage.isMacPlatform());
  const differs = actual != null && actual !== binding;
  return {
    success: true,
    data: {
      configured,
      configuredBinding: binding,
      actual: actual ?? null,
      differs,
    },
  };
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-element-picker') return;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) return;
    await toggleElementPickInTab(tabId);
  } catch (e) {
    console.warn('[taskChromePlugin] toggleElementPick shortcut failed:', e.message || e);
  }
});

// ---- 启动时恢复配置 ----
(async function init() {
  try {
    await Storage.migrateStaleTokenExpiryOnce();
    const cfg = await Storage.getApiConfig();
    const mapping = await Storage.getEndpointMapping();
    const cred = await Storage.getCredentials();
    API.init(cfg.baseUrl, cfg.token, mapping, cred.userId || '');
    if (mapping.owner) API.setOwner(mapping.owner);
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) activeTabId = tabs[0].id;
    } catch (_) { /* ignore */ }
    // 启动即暖缓存（getCaptureConfigCached），webRequest 热路径零 storage IPC
    const captureCfg = await getCaptureConfigCached();
    console.log(
      `[taskChromePlugin] Initialized | baseUrl=${cfg.baseUrl} | ` +
      `hasToken=${!!cfg.token} | captureEnabled=${captureCfg.enabled} | ` +
      `activeTab=${activeTabId} | endpointOverrides=${Object.keys(mapping).join(',') || 'none'}`
    );
  } catch (e) {
    console.error('[taskChromePlugin] Service Worker 初始化失败:', e);
  }

  // 启动账号过期定期检查（每 30 分钟）
  startAccountExpiryCheck();
})();

// ---- 账号过期主动检测 ----

const ACCOUNT_CHECK_ALARM_NAME = 'accountExpiryCheck';
const ACCOUNT_CHECK_INTERVAL_MIN = 30; // 每 30 分钟检查一次

/**
 * 启动定期账号过期检测 alarm。
 * MV3 Service Worker 可能随时被终止，alarm 会唤醒 SW 重新初始化。
 *
 * 注意：chrome.alarms 依赖 manifest "alarms" 权限。权限缺失时该 API 为 undefined，
 * 直接在顶层调用会抛 TypeError 导致 SW 启动失败、整个扩展 runtime 消息通道中断
 * （所有 chrome.runtime.sendMessage 超时）。因此此处与下方顶层 onAlarm listener
 * 都必须做权限守卫，权限缺失时仅降级跳过，不得抛出。
 */
function startAccountExpiryCheck() {
  if (typeof chrome.alarms === 'undefined') {
    console.warn('[taskChromePlugin] chrome.alarms 不可用（manifest 缺 alarms 权限），跳过账号过期检测');
    return;
  }
  chrome.alarms.get(ACCOUNT_CHECK_ALARM_NAME, (existing) => {
    if (!existing) {
      chrome.alarms.create(ACCOUNT_CHECK_ALARM_NAME, {
        delayInMinutes: 3,  // 首次启动 3 分钟后检查
        periodInMinutes: ACCOUNT_CHECK_INTERVAL_MIN,
      });
      console.log('[taskChromePlugin] 账号过期检测已启动（每30分钟）');
    }
  });
}

if (typeof chrome.alarms !== 'undefined') {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ACCOUNT_CHECK_ALARM_NAME) {
      checkAllAccountsForExpiry().catch((e) => {
        console.warn('[taskChromePlugin] 账号过期检测失败:', e.message || e);
      });
    }
  });
}

/**
 * 检查所有已保存账号的 token 有效性。
 * 对每个账号调用 /api/accounts/users/me/ 探测，401/403 表示失效。
 * 失效账号通过 postMessage 广播给所有页面。
 */
async function checkAllAccountsForExpiry() {
  let accounts = [];
  try {
    const list = await MultiAccount.listSavedAccounts();
    if (!Array.isArray(list) || list.length === 0) return;
    accounts = list;
  } catch (e) {
    console.warn('[taskChromePlugin] 获取已保存账号列表失败:', e.message || e);
    return;
  }

  const expiredAccounts = [];
  const baseUrl = (await Storage.getApiConfig()).baseUrl;

  for (const acct of accounts) {
    if (!acct.token || !acct.userId) continue;
    try {
      const resp = await fetch(`${baseUrl}/api/accounts/users/me/`, {
        method: 'GET',
        headers: {
          'Authorization': `Token ${acct.token}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.status === 401 || resp.status === 403) {
        expiredAccounts.push({
          userId: acct.userId,
          username: acct.username || '',
        });
      }
    } catch (e) {
      // 网络错误不视为过期（可能是离线），静默跳过
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        console.warn(`[taskChromePlugin] 账号 ${acct.username} token 检查超时`);
      }
    }
  }

  if (expiredAccounts.length > 0) {
    console.log(`[taskChromePlugin] 检测到 ${expiredAccounts.length} 个账号 token 已过期:`,
      expiredAccounts.map(a => a.username || a.userId).join(', '));
    // 只写 storage：各页经 onChanged 刷新。不再 tabs.query({}) 扇出。
    try {
      await MultiAccount.pruneSavedAccounts(expiredAccounts.map(a => a.userId));
    } catch (e) {
      console.warn('[taskChromePlugin] 过期账号槽位清理失败:', e?.message || e);
    }
  }
}
