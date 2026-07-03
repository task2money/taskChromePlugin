/**
 * DevTools 入口脚本
 * - 创建 TaskPlugin 面板
 * - 监听网络请求，通过 postMessage 直接发送给 Panel
 * - 同时转发到 background service worker（供 Popup 使用）
 */

const recentRequests = [];
const MAX_BUFFER = 200;
let panelWindowRef = null;

chrome.devtools.network.onRequestFinished.addListener(async (entry) => {
  // 获取响应体：优先用同步 text，回退到异步 getContent
  let responseBody = entry.response.content?.text || '';
  if (!responseBody) {
    try {
      responseBody = await new Promise((resolve) => {
        entry.getContent((content) => resolve(content || ''));
      });
    } catch (_) { /* ignore */ }
  }

  // 获取请求体
  let requestBody = '';
  if (entry.request.postData) {
    requestBody = entry.request.postData.text || '';
    // form data 回退
    if (!requestBody && Array.isArray(entry.request.postData.params)) {
      requestBody = entry.request.postData.params.map(p => `${p.name}=${p.value}`).join('&');
    }
  }

  const req = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    method: entry.request.method,
    url: entry.request.url,
    statusCode: entry.response.status,
    statusText: entry.response.statusText || '',
    type: entry._resourceType || 'unknown',
    time: Math.round(entry.time),
    requestHeaders: entry.request.headers.reduce((acc, h) => {
      acc[h.name] = h.value;
      return acc;
    }, {}),
    responseHeaders: entry.response.headers.reduce((acc, h) => {
      acc[h.name] = h.value;
      return acc;
    }, {}),
    mimeType: entry.response.content?.mimeType || '',
    responseBody: responseBody || '',
    requestBody: requestBody || '',
    timestamp: Date.now(),
  };

  recentRequests.push(req);
  if (recentRequests.length > MAX_BUFFER) {
    recentRequests.splice(0, recentRequests.length - MAX_BUFFER);
  }

  // 直接推送给 Panel（绕过 service worker，确保 Panel 在 SW 休眠时仍能工作）
  if (panelWindowRef) {
    try {
      panelWindowRef.postMessage({ action: 'newRequest', request: req }, '*');
    } catch (_) { /* ignore */ }
  }

  // 同步到 background service worker（供 Popup 使用）
  chrome.runtime.sendMessage({
    action: 'addRecentRequest',
    request: req,
  }).catch(() => {}); // 静默失败 — SW 可能在休眠
});

// 清理过期请求 (每30秒)
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  while (recentRequests.length > 0 && recentRequests[0].timestamp < cutoff) {
    recentRequests.shift();
  }
}, 30000);

// 创建面板
chrome.devtools.panels.create(
  'TaskPlugin',
  '../icons/icon16.png',
  '../panel/panel.html',
  (panel) => {
    console.log('[taskChromePlugin] DevTools panel created');

    panel.onShown.addListener((panelWindow) => {
      panelWindowRef = panelWindow;
      // 将已有请求批量发送给 Panel
      try {
        panelWindow.postMessage({
          action: 'initRequests',
          requests: [...recentRequests],
        }, '*');
      } catch (_) { /* ignore */ }
    });
  }
);
