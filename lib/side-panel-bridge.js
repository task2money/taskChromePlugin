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
    if (locale === 'en') return 'Click the extension icon to open the side panel';
    return '请点击工具栏中的扩展图标打开侧边栏';
  }

  const api = { normalizeSidePanelTab, createDescStorageKey, sidePanelOpenHint };
  global.SidePanelBridge = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
}
