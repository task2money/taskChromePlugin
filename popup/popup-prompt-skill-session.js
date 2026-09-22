/** Popup Skill：插件登录态（工作空间同步门闩）。 */
(function (global) {
  'use strict';

  let loggedInProvider = null;
  let pluginLoggedIn = false;

  async function refreshPluginLoggedIn() {
    if (typeof loggedInProvider === 'function') {
      pluginLoggedIn = !!(await loggedInProvider());
      return pluginLoggedIn;
    }
    try {
      if (typeof sendMessageWithTimeout === 'function') {
        const r = await sendMessageWithTimeout({ action: 'getAuthStatus' }, 4000);
        pluginLoggedIn = !!(r?.success && r.data?.loggedIn && !r.data?.expired && r.data?.token);
        return pluginLoggedIn;
      }
    } catch (_) { /* keep previous */ }
    pluginLoggedIn = false;
    return false;
  }

  function defaultSyncTarget(lastKnownWorkspaceId, syncLocal) {
    if (!pluginLoggedIn) return syncLocal;
    return lastKnownWorkspaceId || syncLocal;
  }

  global.PopupPromptSkillSession = {
    refreshPluginLoggedIn,
    defaultSyncTarget,
    isLoggedIn() { return pluginLoggedIn; },
    get loggedInProvider() { return loggedInProvider; },
    set loggedInProvider(fn) { loggedInProvider = fn; },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
