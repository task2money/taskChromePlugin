/**
 * Background Service Worker
 * 功能：
 *  - 顶层注册 webRequest 监听器，自动捕获错误响应
 *  - 将错误请求暂存到 chrome.storage
 *  - 作为 DevTools panel 与 popup 之间的消息桥梁
 */

importScripts('../lib/storage.js', '../lib/api.js');

// ---- 顶层注册 webRequest 监听器 (MV3 最佳实践) ----

chrome.webRequest.onCompleted.addListener(
  handleRequestCompleted,
  { urls: ['<all_urls>'] },
  ['responseHeaders']
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
const tabUrlCache = new Map(); // Map<tabId, url>

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // 仅处理 URL 变化（导航/刷新）
  if (!changeInfo.url) return;
  const prevUrl = tabUrlCache.get(tabId);
  tabUrlCache.set(tabId, changeInfo.url);
  // 首次记录该 tab 的 URL，不清理
  if (!prevUrl) return;
  // URL 未变化（如 title 更新），跳过
  if (prevUrl === changeInfo.url) return;

  // 检查跟踪配置：关闭时清空旧请求
  const trackingCfg = await Storage.getTrackingConfig();
  if (!trackingCfg.enabled) {
    await Storage.clearCapturedErrors();
    // 重置当前活跃 tab 的 5xx 计数
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
    if (tabId < 0) return; // 忽略非 tab 请求（如 service worker）

    // 始终统计 5xx（按 tab 隔离）
    if (details.statusCode >= 500 && details.statusCode < 600) {
      const prev = tab5xxCounts.get(tabId) || 0;
      tab5xxCounts.set(tabId, prev + 1);
      // 只有当前活跃 tab 才更新角标
      if (tabId === activeTabId) {
        updateBadgeForActiveTab();
      }
    }

    // 按 capture 配置决定是否存储详情
    const captureCfg = await Storage.getCaptureConfig();
    if (!captureCfg.enabled) return;

    const isError = matchStatusCode(details.statusCode, captureCfg.statusCodes);
    if (!isError) return;

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url: details.url,
      method: details.method,
      statusCode: details.statusCode,
      statusLine: details.statusLine || '',
      type: details.type,
      timeStamp: details.timeStamp,
      tabId,
      requestHeaders: extractHeaders(details.requestHeaders),
      responseHeaders: extractHeaders(details.responseHeaders),
    };

    await Storage.addCapturedError(entry);
  } catch (_) {
    // 静默处理 storage 读取失败
  }
}

/**
 * 匹配状态码
 */
function matchStatusCode(statusCode, patterns) {
  for (const pattern of patterns || ['2xx', '3xx', '4xx', '5xx']) {
    if (pattern === '2xx' && statusCode >= 200 && statusCode < 300) return true;
    if (pattern === '3xx' && statusCode >= 300 && statusCode < 400) return true;
    if (pattern === '4xx' && statusCode >= 400 && statusCode < 500) return true;
    if (pattern === '5xx' && statusCode >= 500 && statusCode < 600) return true;
    if (/^\d{3}$/.test(pattern) && parseInt(pattern, 10) === statusCode) return true;
  }
  return false;
}

/**
 * 提取 headers 为普通对象
 */
function extractHeaders(headers) {
  if (!headers) return {};
  const obj = {};
  for (const h of headers) {
    obj[h.name] = h.value;
  }
  return obj;
}

// ---- 内存中的请求缓存 (DevTools 转发) ----

let devToolsRequests = [];
const MAX_DEVTOOLS_REQUESTS = 500;

// ---- 消息处理 ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true;
});

async function handleMessage(message, sender) {
  switch (message.action) {
    case 'ping':
      return { pong: true };

    case 'resetBadge':
      // 清零当前活跃 tab 的 5xx 计数
      tab5xxCounts.set(activeTabId, 0);
      updateBadgeForActiveTab();
      return { success: true };

    case 'addRecentRequest':
      // DevTools 转发请求到 background 缓存
      devToolsRequests.push(message.request);
      if (devToolsRequests.length > MAX_DEVTOOLS_REQUESTS) {
        devToolsRequests.splice(0, devToolsRequests.length - MAX_DEVTOOLS_REQUESTS);
      }
      return { success: true };

    case 'getRecentRequests':
      // 面板查询最近的请求
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
        API.init(message.baseUrl, undefined, message.endpointMapping);
        if (message.endpointMapping) {
          API.setEndpointMapping(message.endpointMapping);
          if (message.endpointMapping.owner) API.setOwner(message.endpointMapping.owner);
        }
        const result = await API.loginWithAccessToken(message.accessToken);
        const token = result.token || result.access_token;
        if (token) {
          await Storage.saveApiConfig(message.baseUrl, token);
          const cc = result.user?.current_company;
          await Storage.saveCredentials('(访问令牌)', `token:${message.accessToken}`, result.user?.id || '', cc?.member_id || '');
        }
        return { success: true, data: result };
      } catch (e) {
        return { success: false, error: e.message };
      }

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

    case 'createTask':
      try {
        API.init(message.baseUrl, message.token, message.endpointMapping);
        const data = await API.createTask(message.taskData);
        // 记录历史
        await Storage.addTaskHistory({
          type: 'single',
          title: message.taskData?.title || '(无标题)',
          workspaceId: message.taskData?.workspaceId,
          projectIds: message.taskData?.projectIds,
          status: 'success',
          resultId: data?.id || data?._id,
          taskData: message.taskData,
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
        const data = await API.createTasksBatch(message.tasksData);
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

    case 'setCaptureEnabled':
      if (message.enabled) {
        await Storage.saveCaptureConfig(true, message.statusCodes || ['2xx', '3xx', '4xx', '5xx']);
      } else {
        await Storage.saveCaptureConfig(false, message.statusCodes || ['2xx', '3xx', '4xx', '5xx']);
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

    // ---- 历史记录 ----
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

    // ---- 端点映射 ----
    case 'getEndpointMapping':
      return { success: true, data: await Storage.getEndpointMapping() };

    case 'saveEndpointMapping':
      await Storage.saveEndpointMapping(message.mapping);
      API.setEndpointMapping(message.mapping);
      if (message.mapping.owner) {
        API.setOwner(message.mapping.owner);
      }
      return { success: true };

    // ---- 悬浮球配置 ----
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
  const cfg = await Storage.getApiConfig();
  const mapping = await Storage.getEndpointMapping();
  API.init(cfg.baseUrl, cfg.token, mapping);
  if (mapping.owner) API.setOwner(mapping.owner);
  // 查询当前活跃 tab
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
})();
