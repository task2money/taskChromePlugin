/**
 * 设置页展示工具栏是否已固定。只读 chrome.action.getUserSettings。
 */
(function (global) {
  function statusEl() {
    return document.getElementById('toolbarPinStatus');
  }

  function applyView(settings) {
    const el = statusEl();
    if (!el || !global.ToolbarPin) return;
    const view = global.ToolbarPin.toolbarPinView(settings);
    const t = global.AidevpushI18n && global.AidevpushI18n.t
      ? global.AidevpushI18n.t.bind(global.AidevpushI18n)
      : function (key) { return key; };
    el.textContent = t(view.statusKey);
    el.className = view.badgeClass;
    el.dataset.pinned = view.pinned ? '1' : '0';
    console.info('[taskChromePlugin] toolbar pin', {
      pinned: view.pinned,
      known: view.known,
      writable: false,
    });
  }

  function extAction() {
    const chromeApi = typeof chrome !== 'undefined' ? chrome : global.chrome;
    return chromeApi && chromeApi.action ? chromeApi.action : null;
  }

  async function refresh() {
    let settings = null;
    try {
      const action = extAction();
      if (action && action.getUserSettings) {
        settings = await action.getUserSettings();
      }
    } catch (e) {
      console.info('[taskChromePlugin] toolbar pin read failed', {
        message: e && e.message ? e.message : String(e),
      });
      settings = null;
    }
    applyView(settings);
  }

  function bind() {
    refresh();
    try {
      const action = extAction();
      if (action && action.onUserSettingsChanged && action.onUserSettingsChanged.addListener) {
        action.onUserSettingsChanged.addListener(function () { refresh(); });
      }
    } catch (_) { /* 非扩展页 */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  global.PopupToolbarPin = { refresh: refresh };
})(typeof globalThis !== 'undefined' ? globalThis : window);
