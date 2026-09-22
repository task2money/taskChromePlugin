/**
 * Popup / Panel language <select> (ADR-0089).
 * Local setLocale always; PATCH profile only via SW when logged in.
 */
(function (global) {
  'use strict';

  let boundSelect = null;
  let boundI18n = null;

  function syncSelect() {
    if (!boundSelect || !boundI18n) return;
    const loc = boundI18n.getLocale();
    boundSelect.value = loc === 'en' ? 'en' : 'zh-CN';
  }

  /**
   * @param {{
   *   select: HTMLSelectElement|null,
   *   i18n: { getLocale: Function, setLocale: Function, normalize: Function, applyDom: Function },
   *   sendMessage: (msg: object) => Promise<unknown>,
   *   onApplied?: () => void,
   *   storage?: { onChanged?: { addListener: Function } },
   * }} opts
   */
  function bind(opts) {
    const o = opts || {};
    const select = o.select;
    const i18n = o.i18n;
    if (!select || !i18n) return { syncSelect };
    if (select.__pluginLocaleBound) {
      boundSelect = select;
      boundI18n = i18n;
      syncSelect();
      return { syncSelect };
    }
    select.__pluginLocaleBound = true;
    boundSelect = select;
    boundI18n = i18n;
    syncSelect();

    select.addEventListener('change', async function onLocaleChange(ev) {
      const next = i18n.normalize(ev && ev.target && ev.target.value) || 'zh-CN';
      i18n.setLocale(next);
      if (typeof i18n.applyDom === 'function') {
        i18n.applyDom(typeof document !== 'undefined' ? document : undefined);
      }
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN';
      }
      syncSelect();
      if (typeof o.onApplied === 'function') o.onApplied();
      if (typeof o.sendMessage === 'function') {
        try {
          await o.sendMessage({ action: 'syncPreferredLocale', locale: next });
        } catch (_) {
          /* fail-open */
        }
      }
    });

    try {
      const storage = o.storage || (typeof chrome !== 'undefined' ? chrome.storage : null);
      if (storage && storage.onChanged && typeof storage.onChanged.addListener === 'function') {
        storage.onChanged.addListener(function onLocaleStorage(changes, area) {
          if (area && area !== 'local') return;
          const c = changes && changes['aidevpush.locale'];
          if (!c) return;
          const loc = i18n.normalize(c.newValue);
          if (!loc) return;
          if (loc === i18n.getLocale()) {
            syncSelect();
            return;
          }
          i18n.setLocale(loc);
          if (typeof i18n.applyDom === 'function') {
            i18n.applyDom(typeof document !== 'undefined' ? document : undefined);
          }
          if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.lang = loc === 'en' ? 'en' : 'zh-CN';
          }
          syncSelect();
          if (typeof o.onApplied === 'function') o.onApplied();
        });
      }
    } catch (_) {
      /* ignore */
    }
    return { syncSelect };
  }

  const api = { bind, syncSelect };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.PluginLocaleSwitcher = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
