/**
 * oauth-callback.html 引导脚本（OPT-20260808-024）
 * 组装扩展环境依赖后调用 OAuthCallback.handleCallback：
 * - storageGet: chrome.storage.local.get(SESSION_KEY)
 * - sendMessage: chrome.runtime.sendMessage（含 tabId=null，SW 用当前 tab 关闭回调页）
 */
(function () {
  'use strict';

  (async function boot() {
    // OPT-20260827-024 / ADR-0089：品牌名与标题、h1 走 i18n——
    // applyDom 按 plugin-brand.js 的 SSOT 注入 {brand}，改名时本页自动跟随。
    // 与 popup/panel/content 同约定：先 hydrate 持久化 locale，否则本页永远落到
    // i18n.js 的 zh-CN 默认值，切 en 的用户会看到中文。
    if (globalThis.AidevpushI18n && typeof globalThis.AidevpushI18n.hydrateFromStorage === 'function') {
      await globalThis.AidevpushI18n.hydrateFromStorage().catch(() => {});
    }
    if (globalThis.AidevpushI18n && typeof globalThis.AidevpushI18n.applyDom === 'function') {
      globalThis.AidevpushI18n.applyDom(document);
    }

    const resultEl = document.getElementById('result');
    const render = (r) => {
      if (!resultEl) return;
      resultEl.textContent = r.message;
      resultEl.className = r.status === 'ok' ? 'status-ok' : 'status-error';
    };

    await OAuthCallback.handleCallback({
      location,
      chrome,
      storageGet: () => chrome.storage.local.get(OAuthCallback.SESSION_KEY),
      sendMessage: (msg) => chrome.runtime.sendMessage(msg),
      render,
    });
  })().catch((e) => {
    const resultEl = document.getElementById('result');
    if (resultEl) {
      resultEl.textContent = tx('oauthCallbackBootException', {
        reason: e?.message || tx('oauthCallbackUnknownError'),
      });
    }
  });
})();
