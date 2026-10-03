/**
 * Probe Chrome LanguageModel for EdgeNode supported_models (ADR-0138).
 * Canonical id: builtin-edge (matches AIEndPoint default chat model).
 */
(function (root) {
  'use strict';

  const CANONICAL_MODEL = 'builtin-edge';

  /**
   * @param {object|null|undefined} languageModel globalThis.LanguageModel
   * @param {{probe?: Function}|null|undefined} builtinPrompt PageAdvisorBuiltinPrompt
   * @param {string} [locale]
   * @returns {Promise<string[]>}
   */
  async function probeBuiltinEdgeSupportedModels(languageModel, builtinPrompt, locale) {
    if (!languageModel || !builtinPrompt || typeof builtinPrompt.probe !== 'function') {
      return [];
    }
    try {
      const availability = await builtinPrompt.probe(languageModel, locale || 'zh-CN');
      if (availability && availability !== 'unavailable') {
        return [CANONICAL_MODEL];
      }
    } catch (_) {
      return [];
    }
    return [];
  }

  const api = {
    CANONICAL_MODEL,
    probeBuiltinEdgeSupportedModels,
  };
  root.BuiltinEdgeSupportedModels = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
