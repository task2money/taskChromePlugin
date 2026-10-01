/**
 * 页内浮窗是否展示「未固定到工具栏」提示。只读判断，不写固定状态。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  var TOOLBAR_PIN_PAGE_HINT_DISMISSED_KEY = 'toolbarPinPageHintDismissed';

  function shouldShowToolbarPinPageHint(state) {
    if (!state || state.dismissed === true) return false;
    if (state.known !== true) return false;
    return state.pinned === false;
  }

  var api = {
    TOOLBAR_PIN_PAGE_HINT_DISMISSED_KEY: TOOLBAR_PIN_PAGE_HINT_DISMISSED_KEY,
    shouldShowToolbarPinPageHint: shouldShowToolbarPinPageHint,
  };
  global.ToolbarPinHint = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
