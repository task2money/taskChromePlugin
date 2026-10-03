/**
 * 侧栏「本机模型」Tab：初始化 API + 登录态，驱动本机模型出售面板。
 */
(function initSidepanelEdgeSellBoot() {
  'use strict';

  async function syncLoginFromStorage() {
    try {
      if (typeof Storage !== 'undefined' && Storage.getApiConfig && typeof API !== 'undefined') {
        const cfg = await Storage.getApiConfig();
        const mapping = await Storage.getEndpointMapping?.() || {};
        const cred = await Storage.getCredentials?.() || {};
        API.init(cfg.baseUrl, cfg.token, mapping, cred.userId || '');
        const loggedIn = Boolean(cfg.token);
        globalThis.PopupBuiltinEdgeSell?.setLoggedIn?.(loggedIn);
        return loggedIn;
      }
    } catch (e) {
      console.warn('[sidepanel] edge sell boot failed:', e?.message || e);
    }
    globalThis.PopupBuiltinEdgeSell?.setLoggedIn?.(false);
    return false;
  }

  function bindStorage() {
    if (!chrome.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.token || changes.baseUrl || changes.refreshToken) {
        syncLoginFromStorage().catch(() => {});
      }
    });
  }

  function boot() {
    bindStorage();
    syncLoginFromStorage().catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
