/**
 * 侧边栏页签名与任务描述草稿键（无 Chrome API，供 SW 与单测共用）。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function initSidePanelBridge(global) {
  'use strict';

  function normalizeSidePanelTab(which) {
    if (which === 'settings') return 'settings';
    if (which === 'builtin') return 'builtin';
    return 'create';
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

  /**
   * 侧边栏变为可见时的页签：图标打开固定「设置」；
   * 页面消息（填入任务描述、悬浮球）在 2 秒内保留其页签。
   */
  function resolveSidePanelOnShow(source, storedTab, now) {
    if (!iconOpenShouldSelectSettings(source, now)) {
      return normalizeSidePanelTab(storedTab);
    }
    return 'settings';
  }

  /**
   * 内存中的页面消息（悬浮球）优先于 session。
   * sidePanel.open 必须在写入 storage 之前发出，onOpened 不能只看尚未写完的 storage。
   */
  function resolveSidePanelIntent(pending, storedSource, storedTab, now) {
    const at = pending && pending.kind === 'message' ? Number(pending.at) : NaN;
    if (Number.isFinite(at) && (Number(now) - at) < 2000) {
      return normalizeSidePanelTab(pending.which);
    }
    return resolveSidePanelOnShow(storedSource, storedTab, now);
  }

  const api = {
    normalizeSidePanelTab,
    createDescStorageKey,
    sidePanelOpenHint,
    toolbarActionPanelBehavior,
    iconOpenShouldSelectSettings,
    resolveSidePanelOnShow,
    resolveSidePanelIntent,
  };
  global.SidePanelBridge = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
}
