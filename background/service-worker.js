/**
 * Background Service Worker
 * 功能：
 *  - 顶层注册 webRequest 监听器，自动捕获错误响应
 *  - 将错误请求暂存到 chrome.storage
 *  - 作为 DevTools panel 与 popup 之间的消息桥梁
 */

importScripts(
  // i18n 必须最先加载：SW 侧取词依赖 lib/i18n-tx.js 先于所有业务脚本建立全局取词器。
  // 注意：本注释内不得出现右圆括号，swBundle.js 以 importScripts 的首个右圆括号定界。
  '../lib/i18n.js',
  '../lib/i18n-messages.js',
  '../lib/i18n-ui-messages.js',
  '../lib/i18n-tx.js',
  '../lib/storage.js',
  '../lib/create-task-git-identity.js',
  '../lib/branch-datalist.js',
  '../lib/create-task-payload.js',
  '../lib/client-public-ip.js',
  '../lib/workspace-list.js',
  '../lib/api-http.js',
  '../lib/api.js',
  '../lib/profile-locale.js',
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
  '../lib/click-guard.js',
  '../lib/page-advisor-api.js',
  '../lib/page-advisor-fail-trace-id.js',
  '../lib/page-advisor-llm-config.js',
  '../lib/page-advisor-preset-skills.js',
  '../lib/page-advisor-prompt-skills.js',
  '../lib/page-advisor-locale-prompt.js',
  '../lib/page-advisor-llm-client.js',
  '../lib/page-advisor-defaults.js',
  '../lib/page-advisor-site-pending.js',
  './sw-capture.js',
  './sw-auth.js',
  './sw-messages-session.js',
  './sw-messages-task.js',
  './sw-pick.js',
  './sw-page-advisor.js',
  './sw-page-advisor-pending.js',
);


/**
 * i18n 就绪门（ADR-0089）。
 * importScripts 是同步的，但 hydrateFromStorage 读 chrome.storage 是异步的：
 * 冷启动后首批消息若不等它，会按 zh-CN 默认值取词（切 en 无效）。
 * 故所有对外入口先 await 本 Promise；hydrate 失败不阻断业务，仅回落默认语言。
 */
const i18nReady = Promise.resolve()
  .then(() => globalThis.AidevpushI18n.hydrateFromStorage())
  .catch((e) => {
    console.warn('[taskChromePlugin] i18n hydrate 失败，回落默认语言:', e?.message || e);
  });

function whenI18nReady() {
  return i18nReady;
}


// ---- 内存中的请求缓存 (DevTools 转发) ----

let devToolsRequests = [];
const MAX_DEVTOOLS_REQUESTS = 500;

// ---- 消息处理 ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  whenI18nReady()
    .then(() => handleMessage(message, sender))
    .then(sendResponse)
    .catch((err) => {
      console.error('[taskChromePlugin] handleMessage 异常:', err);
      sendResponse({ success: false, error: err?.message || tx('swInternalError') });
    });
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  await whenI18nReady();
  if (command === 'page-optimization-suggest') {
    try {
      await handlePageOptimizationSuggestCommand();
    } catch (e) {
      console.warn('[taskChromePlugin] page-optimization-suggest failed:', e.message || e);
    }
    return;
  }
  if (command === 'page-optimization-suggest-region') {
    try {
      await handlePageOptimizationSuggestRegionCommand();
    } catch (e) {
      console.warn('[taskChromePlugin] page-optimization-suggest-region failed:', e.message || e);
    }
    return;
  }
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
    await whenI18nReady();
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
    if (typeof clearLegacyPageAdvisorChromeShortcuts === 'function') {
      await clearLegacyPageAdvisorChromeShortcuts();
    }
    if (typeof registerPageAdvisorSitePendingHooks === 'function') {
      registerPageAdvisorSitePendingHooks();
    }
    console.log(
      `[taskChromePlugin] Initialized | baseUrl=${cfg.baseUrl} | ` +
      `hasToken=${!!cfg.token} | captureEnabled=${captureCfg.enabled} | ` +
      `activeTab=${activeTabId} | endpointOverrides=${Object.keys(mapping).join(',') || 'none'}`
    );
  } catch (e) {
    console.error('[taskChromePlugin] Service Worker 初始化失败:', e);
  }
})();
