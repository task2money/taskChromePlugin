/** Popup Skill：插件登录态（工作空间同步门闩）。 */
(function (global) {
  'use strict';

  let loggedInProvider = null;
  let sessionProvider = null;
  let pluginLoggedIn = false;

  function normalizeAdvisorSession(raw) {
    const baseUrl = String(raw?.baseUrl || '').replace(/\/+$/, '');
    const token = String(raw?.token || '').trim();
    if (!baseUrl || !token) return null;
    return { baseUrl, token };
  }

  async function refreshPluginLoggedIn() {
    if (typeof loggedInProvider === 'function') {
      pluginLoggedIn = !!(await loggedInProvider());
      return pluginLoggedIn;
    }
    pluginLoggedIn = !!(await resolveAdvisorSession());
    return pluginLoggedIn;
  }

  async function resolveAdvisorSession() {
    if (typeof sessionProvider === 'function') {
      return normalizeAdvisorSession(await sessionProvider());
    }
    try {
      if (typeof sendMessageWithTimeout === 'function') {
        const r = await sendMessageWithTimeout({ action: 'getAuthStatus' }, 4000);
        if (r?.success && r.data && !r.data.expired) {
          const s = normalizeAdvisorSession(r.data);
          if (s) return s;
        }
      }
    } catch (_) { /* fall through */ }
    try {
      if (typeof Storage !== 'undefined' && typeof Storage.getApiConfig === 'function') {
        const expired = typeof Storage.isTokenExpired === 'function' && await Storage.isTokenExpired();
        if (!expired) {
          const s = normalizeAdvisorSession(await Storage.getApiConfig());
          if (s) return s;
        }
      }
    } catch (_) { /* fall through */ }
    if (typeof API !== 'undefined' && typeof API.getToken === 'function') {
      return normalizeAdvisorSession({ baseUrl: API.getBaseUrl(), token: API.getToken() });
    }
    return null;
  }

  function defaultSyncTarget(lastKnownWorkspaceId, syncLocal) {
    if (!pluginLoggedIn) return syncLocal;
    return lastKnownWorkspaceId || syncLocal;
  }

  global.PopupPromptSkillSession = {
    refreshPluginLoggedIn,
    resolveAdvisorSession,
    normalizeAdvisorSession,
    defaultSyncTarget,
    isLoggedIn() { return pluginLoggedIn; },
    get loggedInProvider() { return loggedInProvider; },
    set loggedInProvider(fn) { loggedInProvider = fn; },
    get sessionProvider() { return sessionProvider; },
    set sessionProvider(fn) { sessionProvider = fn; },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
