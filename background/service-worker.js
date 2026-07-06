/**
 * Background Service Worker
 * 功能：
 *  - 顶层注册 webRequest 监听器，自动捕获错误响应
 *  - 将错误请求暂存到 chrome.storage
 *  - 作为 DevTools panel 与 popup 之间的消息桥梁
 */

importScripts('../lib/storage.js', '../lib/api.js', '../lib/capture-status.js');

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

    if (details.statusCode >= 500 && details.statusCode < 600) {
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
          list = list.filter((r) => r.statusCode >= 400);
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
        API.init(message.baseUrl, undefined, message.endpointMapping);
        if (message.endpointMapping) {
          API.setEndpointMapping(message.endpointMapping);
          if (message.endpointMapping.owner) API.setOwner(message.endpointMapping.owner);
        }
        const result = await API.login(message.username, message.password);
        const token = result.token || result.access_token;
        if (token) {
          await Storage.saveApiConfig(message.baseUrl, token);
          const cc = result.user?.current_company;
          await Storage.saveCredentials(message.username, result.user?.id || '', cc?.member_id || '');
        }
        return { success: true, data: result };
      } catch (e) {
        return { success: false, error: e.message };
      }

    case 'loginWithAccessToken':
      try {
        if (!message.username || !String(message.username).trim()) {
          return { success: false, error: '请填写账号' };
        }
        if (!API.isAccessTokenFormat(message.accessToken)) {
          return { success: false, error: '访问令牌格式无效，应以 at_ 开头' };
        }
        API.init(message.baseUrl, undefined, message.endpointMapping);
        if (message.endpointMapping) {
          API.setEndpointMapping(message.endpointMapping);
          if (message.endpointMapping.owner) API.setOwner(message.endpointMapping.owner);
        }
        const result = await API.loginWithAccessToken(message.username, message.accessToken);
        const token = result.token || result.access_token;
        if (token) {
          await Storage.saveApiConfig(message.baseUrl, token);
          const cc = result.user?.current_company;
          const displayName = message.username || result.user?.username || result.user?.email || '';
          await Storage.saveCredentials(displayName, result.user?.id || '', cc?.member_id || '');
        }
        return { success: true, data: result };
      } catch (e) {
        return { success: false, error: e.message };
      }

    // ---- 工作空间/项目/成员 ----

    case 'getWorkspaces':
      try {
        API.init(message.baseUrl, message.token);
        const data = await API.getWorkspaces();
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message };
      }

    case 'getProjects':
      try {
        API.init(message.baseUrl, message.token);
        const data = await API.getProjects(message.workspaceId);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message };
      }

    case 'getMembers':
      try {
        API.init(message.baseUrl, message.token);
        const data = await API.getMembers(message.companyId);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message };
      }

    case 'fetchProgressColumns':
      try {
        API.init(message.baseUrl, message.token);
        const data = await API.fetchProgressColumns(message.companyId, message.workspaceId);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message };
      }

    case 'getBranches':
      try {
        API.init(message.baseUrl, message.token);
        const data = await API.getBranches(message.companyId, message.projectId, message.repoUrl);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message };
      }

    // ---- 任务创建 ----

    case 'createTask':
      try {
        API.init(message.baseUrl, message.token, message.endpointMapping);
        applyEndpointOwner(message.endpointMapping);
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
        return { success: false, error: e.message };
      }

    case 'createTasksBatch':
      try {
        API.init(message.baseUrl, message.token, message.endpointMapping);
        applyEndpointOwner(message.endpointMapping);
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
        return { success: false, error: e.message };
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
        return { success: false, error: e.message };
      }

    case 'saveFloatBallConfig':
      try {
        await Storage.saveFloatBallConfig(message.enabled);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }

    case 'getFloatBallPosition':
      try {
        return { success: true, data: await Storage.getFloatBallPosition() };
      } catch (e) {
        return { success: false, error: e.message };
      }

    case 'saveFloatBallPosition':
      try {
        await Storage.saveFloatBallPosition(message.x, message.y);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }

    default:
      return { error: `Unknown action: ${message.action}` };
  }
}

// ---- 启动时恢复配置 ----
(async function init() {
  try {
    const cfg = await Storage.getApiConfig();
    const mapping = await Storage.getEndpointMapping();
    API.init(cfg.baseUrl, cfg.token, mapping);
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
})();
