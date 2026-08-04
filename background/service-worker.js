/**
 * Background Service Worker
 * 功能：
 *  - 顶层注册 webRequest 监听器，自动捕获错误响应
 *  - 将错误请求暂存到 chrome.storage
 *  - 作为 DevTools panel 与 popup 之间的消息桥梁
 */

importScripts(
  '../lib/storage.js',
  '../lib/create-task-payload.js',
  '../lib/client-public-ip.js',
  '../lib/api.js',
  '../lib/capture-status.js',
  '../lib/element-picker.js',
  '../lib/async-timeout.js',
  '../lib/login-finalize.js',
  '../lib/multi-account.js',
);

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

/**
 * 处理完成的请求 — 按 tab 隔离计数，按 capture 配置存储详情
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
        updateBadgeForActiveTab();
      }
    }

    const captureCfg = await Storage.getCaptureConfig();
    if (!captureCfg.enabled) return;

    const isError = CaptureStatus.matchStatusCode(details.statusCode, captureCfg.statusCodes, { canceled: false });
    if (!isError) return;

    const entry = buildCapturedEntry({
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

    await Storage.addCapturedError(entry);
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

    const captureCfg = await Storage.getCaptureConfig();
    if (!captureCfg.enabled) return;

    const canceled = true;
    const statusCode = 0;
    const statusLine = 'Canceled';

    const isMatch = CaptureStatus.matchStatusCode(statusCode, captureCfg.statusCodes, { canceled });
    if (!isMatch) return;

    const entry = buildCapturedEntry({
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

    await Storage.addCapturedError(entry);
  } catch (_) {
    // 静默处理 storage 读取失败
  }
}

function buildCapturedEntry(fields) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...fields,
  };
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

/** 单标签广播超时：discarded/frozen 页上 sendMessage 可能永不 resolve */
const AUTH_BROADCAST_TAB_TIMEOUT_MS = 800;

/** 向所有标签页广播登录态变更（content script / panel 监听） */
async function broadcastAuthStateChanged() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(
      tabs.map((tab) => {
        if (!tab.id) return Promise.resolve();
        const send = chrome.tabs.sendMessage(tab.id, { action: 'authStateChanged' }).catch(() => {});
        if (typeof withTimeout === 'function') {
          return withTimeout(send, AUTH_BROADCAST_TAB_TIMEOUT_MS, 'auth broadcast').catch(() => {});
        }
        return send;
      }),
    );
  } catch (e) {
    console.warn('[taskChromePlugin] broadcastAuthStateChanged 失败:', e.message || e);
  }
}

/** 登录成功：持久化（带超时）+ 异步广播，绝不因广播阻塞 Popup */
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
    broadcast: broadcastAuthStateChanged,
  };

  try {
    await finalizeLoginSuccess(persistOpts);
  } catch (e) {
    console.warn('[taskChromePlugin] 保存登录态失败/超时，后台重试:', e?.message || e);
    // 后台再试一次（无超时包装由 storage 自身决定），广播仍不阻塞响应
    void persistLoginCredentials({ ...persistOpts, timeoutMs: 0 }).catch((err) => {
      console.warn('[taskChromePlugin] 登录态后台重试仍失败:', err?.message || err);
    });
    scheduleAuthBroadcast(broadcastAuthStateChanged);
  }
  return { success: true, data: result };
}

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
        const cfg = await Storage.getApiConfig();
        const cred = await Storage.getCredentials();
        const expired = await Storage.isTokenExpired();
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

    case 'updateApiConfig':
      API.init(message.baseUrl, message.token);
      await Storage.saveApiConfig(message.baseUrl, message.token);
      return { success: true };

    // ---- 向后兼容：保留旧登录方式作为 fallback ----

    case 'login':
      try {
        // 清空内存脏 Token，避免登录请求带 Authorization
        API.init(message.baseUrl, '', message.endpointMapping, '');
        if (message.endpointMapping) {
          API.setEndpointMapping(message.endpointMapping);
          if (message.endpointMapping.owner) API.setOwner(message.endpointMapping.owner);
        }
        const result = await API.login(message.username, message.password);
        const token = result.token || result.access_token;
        if (!token) {
          return { success: false, error: '登录成功但未返回 session token，请重试' };
        }
        const expiresIn = Number(result.expires_in || result.expiresIn || 0);
        const cc = result.user?.current_company;
        return await completeLoginAndRespond(
          message.baseUrl,
          token,
          expiresIn,
          message.username,
          result.user?.id || '',
          cc?.member_id || '',
          result,
        );
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'loginWithAccessToken':
      try {
        if (!message.username || !String(message.username).trim()) {
          return { success: false, error: '请填写账号' };
        }
        if (!API.isAccessTokenFormat(message.accessToken)) {
          return { success: false, error: '访问令牌格式无效，应以 at_ 开头' };
        }
        // 清空内存脏 Token，登录走 requestUnauthenticated
        API.init(message.baseUrl, '', message.endpointMapping, '');
        if (message.endpointMapping) {
          API.setEndpointMapping(message.endpointMapping);
          if (message.endpointMapping.owner) API.setOwner(message.endpointMapping.owner);
        }
        const result = await API.loginWithAccessToken(message.username, message.accessToken);
        const token = result.token || result.access_token;
        if (!token) {
          return { success: false, error: '登录成功但未返回 session token，请重试' };
        }
        const expiresIn = Number(result.expires_in || result.expiresIn || 0);
        const cc = result.user?.current_company;
        const displayName = message.username || result.user?.username || result.user?.email || '';
        return await completeLoginAndRespond(
          message.baseUrl,
          token,
          expiresIn,
          displayName,
          result.user?.id || '',
          cc?.member_id || '',
          result,
        );
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'logout':
      try {
        await Storage.clearAuth();
        API.clearSession();
        // 登出同样不得被标签页广播拖死
        scheduleAuthBroadcast(broadcastAuthStateChanged);
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
        const data = await API.getMembers(message.companyId);
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
      return { success: true };

    case 'getCapturedErrors':
      return { success: true, data: await Storage.getCapturedErrors() };

    case 'clearCapturedErrors':
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

    case 'getSyncDescriptionConfig':
      return { success: true, data: await Storage.getSyncDescriptionConfig() };

    case 'setSyncDescriptionConfig':
      await Storage.saveSyncDescriptionConfig(message.enabled);
      return { success: true };

    case 'syncDescription':
      {
        // 将描述广播到所有其他标签页（排除发送者）
        const senderTabId = sender?.tab?.id;
        if (senderTabId == null) return { success: true };
        try {
          const tabs = await chrome.tabs.query({});
          for (const tab of tabs) {
            if (tab.id == null || tab.id === senderTabId) continue;
            chrome.tabs.sendMessage(tab.id, {
              action: 'syncDescriptionUpdate',
              description: message.description,
              sourceUrl: message.sourceUrl,
            }).catch(() => {});
          }
        } catch (_) { /* ignore */ }
        return { success: true };
      }

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
          // 广播账号切换事件到所有 tab，触发前端状态刷新
          broadcastAuthStateChanged().catch(() => {});
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
          broadcastAuthStateChanged().catch(() => {});
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

    default:
      return { error: `Unknown action: ${message.action}` };
  }
}

/**
 * 向除顶层外的所有 frame 广播选元素指令
 */
async function broadcastPickToChildFrames(tabId, action, source) {
  let frames = [];
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch (e) {
    console.warn('[taskChromePlugin] getAllFrames failed:', e.message || e);
    return;
  }
  for (const f of frames || []) {
    if (!f || f.frameId === 0) continue;
    try {
      await chrome.tabs.sendMessage(tabId, {
        action,
        source: source || 'float',
      }, { frameId: f.frameId });
    } catch (_) {
      /* 部分 frame 可能未注入 pick-frame */
    }
  }
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

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-element-picker') return;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) return;
    await chrome.tabs.sendMessage(tabId, { action: 'toggleElementPick' }, { frameId: 0 });
    console.log('[taskChromePlugin] toggleElementPick via shortcut sent to tab', tabId);
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
    const captureCfg = await Storage.getCaptureConfig();
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
 */
function startAccountExpiryCheck() {
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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ACCOUNT_CHECK_ALARM_NAME) {
    checkAllAccountsForExpiry().catch((e) => {
      console.warn('[taskChromePlugin] 账号过期检测失败:', e.message || e);
    });
  }
});

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
    broadcastAccountExpired(expiredAccounts);
  }
}

/**
 * 向所有标签页广播 accountExpired 事件。
 * content script / page-bridge 会将事件转发给页面。
 */
async function broadcastAccountExpired(expiredAccounts) {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(
      tabs.map((tab) => {
        if (!tab.id) return Promise.resolve();
        const send = chrome.tabs.sendMessage(tab.id, {
          action: 'accountExpired',
          data: { accounts: expiredAccounts },
        }).catch(() => {});
        if (typeof withTimeout === 'function') {
          return withTimeout(send, AUTH_BROADCAST_TAB_TIMEOUT_MS, 'accountExpired broadcast').catch(() => {});
        }
        return send;
      }),
    );
  } catch (e) {
    console.warn('[taskChromePlugin] broadcastAccountExpired 失败:', e.message || e);
  }
}
