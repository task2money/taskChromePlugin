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
  '../lib/workspace-list.js',
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
  '../lib/hot-path-guards.js',
  './sw-capture.js',
  './sw-auth.js',
  './sw-messages-session.js',
  './sw-messages-task.js',
  './sw-pick.js',
  './sw-expiry.js',
);


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
