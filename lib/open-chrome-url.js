/**
 * 在新标签页打开 chrome://（或其它）URL。
 * 扩展页内裸 <a href="chrome://…"> 会被浏览器拦截，须经 chrome.tabs.create
 *（与 popup 快捷键 chrome://extensions/shortcuts 入口同模式）。
 */
(function (global) {
  'use strict';

  const ON_DEVICE_INTERNALS = 'chrome://on-device-internals';

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
    openChromeUrl,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
