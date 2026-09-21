/**
 * Popup 展示用：读取 MV3 manifest.version 并格式化为用户可见文案。
 */
(function (global) {
  'use strict';

  function readExtensionVersion(chromeApi) {
    const api = chromeApi !== undefined
      ? chromeApi
      : (typeof chrome !== 'undefined' ? chrome : undefined);
    try {
      const v = api && api.runtime && typeof api.runtime.getManifest === 'function'
        ? api.runtime.getManifest().version
        : '';
      return String(v || '').trim();
    } catch (_) {
      return '';
    }
  }

  function formatExtensionVersionText(version, translate) {
    const v = String(version || '').trim();
    if (!v) return '';
    if (typeof translate === 'function') {
      return translate('popupVersionLabel', { version: v });
    }
    return 'v' + v;
  }

  function applyExtensionVersionToElement(el, chromeApi, translate) {
    if (!el) return false;
    const version = readExtensionVersion(chromeApi);
    if (!version) {
      el.hidden = true;
      el.textContent = '';
      return false;
    }
    el.hidden = false;
    el.textContent = formatExtensionVersionText(version, translate);
    const aria = typeof translate === 'function'
      ? translate('popupVersionAria', { version })
      : el.textContent;
    if (el.setAttribute) el.setAttribute('aria-label', aria);
    return true;
  }

  const PluginVersion = {
    readExtensionVersion,
    formatExtensionVersionText,
    applyExtensionVersionToElement,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PluginVersion;
  }
  if (global) global.PluginVersion = PluginVersion;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
