/**
 * 工具栏固定状态（只读）。
 * Chrome action 只有 getUserSettings().isOnToolbar，没有写入接口；
 * 企业策略 toolbar_pin 也不能由扩展自己改。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  function toolbarPinView(settings) {
    const known = !!(settings && typeof settings.isOnToolbar === 'boolean');
    const pinned = known && settings.isOnToolbar === true;
    return {
      known: known,
      pinned: pinned,
      writable: false,
    };
  }

  const api = { toolbarPinView: toolbarPinView };
  global.ToolbarPin = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
