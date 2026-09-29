/**
 * 侧边栏页签名与任务描述草稿键（无 Chrome API，供 SW 与单测共用）。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function initSidePanelBridge(global) {
  'use strict';

  function normalizeSidePanelTab(which) {
    return which === 'settings' ? 'settings' : 'create';
  }

  function createDescStorageKey() {
    return 'sidePanelCreateDesc';
  }

  function sidePanelOpenHint(locale) {
    if (locale === 'en') return 'Click the extension icon to open or close the side panel';
    return '请点击工具栏中的扩展图标展开或收起侧边栏';
  }

  /** 工具栏图标交给浏览器切换侧边栏（展开/收起）。 */
  function toolbarActionPanelBehavior() {
    return { openPanelOnActionClick: true };
  }

  /**
   * 图标打开应切到「设置」。页面消息刚打开时不覆盖其页签。
   * source.at 起 2 秒内视为同一次消息打开。
   */
  function iconOpenShouldSelectSettings(source, now) {
    const at = source && source.kind === 'message' ? Number(source.at) : NaN;
    if (!Number.isFinite(at)) return true;
    return (Number(now) - at) >= 2000;
  }

  const api = {
    normalizeSidePanelTab,
    createDescStorageKey,
    sidePanelOpenHint,
    toolbarActionPanelBehavior,
    iconOpenShouldSelectSettings,
  };
  global.SidePanelBridge = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
}
