/**
 * Shorthand for AidevpushI18n.t (ADR-0089). Safe before i18n loads (returns key).
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  'use strict';

  function tx(key, params) {
    try {
      if (global.AidevpushI18n && typeof global.AidevpushI18n.t === 'function') {
        return global.AidevpushI18n.t(key, params);
      }
    } catch (_) {
      /* ignore */
    }
    if (params && typeof params === 'object') {
      return String(key).replace(/\{(\w+)\}/g, (_, k) =>
        params[k] != null ? String(params[k]) : `{${k}}`,
      );
    }
    return key;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { tx };
  }
  global.AidevpushTx = { tx };
  global.tx = tx;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
