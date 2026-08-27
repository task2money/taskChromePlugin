/**
 * oauth-callback.html 引导脚本（OPT-20260808-024）
 * 组装扩展环境依赖后调用 OAuthCallback.handleCallback：
 * - storageGet: chrome.storage.local.get(SESSION_KEY)
 * - sendMessage: chrome.runtime.sendMessage（含 tabId=null，SW 用当前 tab 关闭回调页）
 */
(function () {
  'use strict';

  (async function boot() {
    // OPT-20260827-024：品牌名 SSOT — plugin-brand.js 已先注入，
    // 从 PLUGIN_DISPLAY_NAME 覆写标题与 h1，改名时回调页自动跟随。
    const brandName = (typeof globalThis !== 'undefined' && globalThis.PLUGIN_DISPLAY_NAME) || '';
    if (brandName) {
      document.title = `${brandName} — 登录回调`;
      const h1 = document.querySelector('.card h1');
      if (h1) h1.textContent = `🔐 ${brandName} 登录`;
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
    if (resultEl) resultEl.textContent = `登录处理异常：${e?.message || '未知错误'}`;
  });
})();
