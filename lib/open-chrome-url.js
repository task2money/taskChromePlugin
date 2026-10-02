/**
 * 在新标签页打开 chrome://（或其它）URL。
 * 扩展页内裸 <a href="chrome://…"> 会被浏览器拦截，须经 chrome.tabs.create
 *（popup 快捷键、Beta 下载后扩展管理页、sidepanel on-device-internals 共用）。
 */
(function (global) {
  'use strict';

  const ON_DEVICE_INTERNALS = 'chrome://on-device-internals';
  const EXTENSIONS_SHORTCUTS = 'chrome://extensions/shortcuts';
  const EXTENSIONS_PAGE = 'chrome://extensions/';

  /**
   * @param {string} url
   * @param {{ create: (opts: { url: string }) => Promise<unknown>|unknown }} [tabsApi]
   * @returns {Promise<unknown>}
   */
  function openChromeUrl(url, tabsApi) {
    const api = tabsApi || (typeof chrome !== 'undefined' && chrome.tabs);
    if (!api || typeof api.create !== 'function') {
      return Promise.reject(new Error('tabs.create unavailable'));
    }
    return Promise.resolve(api.create({ url }));
  }

  global.OpenChromeUrl = {
    ON_DEVICE_INTERNALS,
    EXTENSIONS_SHORTCUTS,
    EXTENSIONS_PAGE,
    openChromeUrl,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
