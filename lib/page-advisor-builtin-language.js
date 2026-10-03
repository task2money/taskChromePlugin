/**
 * 本机 Prompt API 语言选项。Gemini Nano 在部分 Chrome 上对 zh 报 unavailable，
 * 须回退 en / 无语言约束，且 availability 与 create 使用同一份 options。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.PageAdvisorBuiltinLanguage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function pageAdvisorBuiltinLanguageFactory() {
  function promptLanguage(locale) {
    const normalize = typeof PageAdvisorLocalePrompt !== 'undefined' && PageAdvisorLocalePrompt.normalize
      ? PageAdvisorLocalePrompt.normalize
      : function fallback(value) {
        return String(value || '').toLowerCase().startsWith('en') ? 'en' : 'zh-CN';
      };
    return normalize(locale) === 'en' ? 'en' : 'zh';
  }

  function languageOptions(locale) {
    const language = promptLanguage(locale);
    return {
      expectedInputs: [{ type: 'text', languages: [language] }],
      expectedOutputs: [{ type: 'text', languages: [language] }],
    };
  }

  function optionLang(options) {
    return options
      && options.expectedInputs
      && options.expectedInputs[0]
      && options.expectedInputs[0].languages
      && options.expectedInputs[0].languages[0];
  }

  function isUsableAvailability(value) {
    return value === 'available' || value === 'downloadable' || value === 'downloading';
  }

  async function probeAvailability(languageModel, options) {
    if (!languageModel || typeof languageModel.availability !== 'function') {
      return 'unavailable';
    }
    try {
      if (options && Object.keys(options).length) {
        return await languageModel.availability(options);
      }
      return await languageModel.availability();
    } catch (_) {
      return 'unavailable';
    }
  }

  let lastResolved = null;

  async function resolveLanguageOptions(languageModel, locale) {
    const preferred = languageOptions(locale);
    const candidates = [preferred];
    if (optionLang(preferred) !== 'en') {
      candidates.push(languageOptions('en'));
    }
    candidates.push({});
    let fallback = preferred;
    for (let i = 0; i < candidates.length; i += 1) {
      const opts = candidates[i];
      const av = await probeAvailability(languageModel, opts);
      if (isUsableAvailability(av)) {
        lastResolved = opts;
        return opts;
      }
      fallback = opts;
    }
    lastResolved = fallback;
    return fallback;
  }

  function cachedLanguageOptions(locale) {
    return lastResolved || languageOptions(locale);
  }

  return {
    promptLanguage,
    languageOptions,
    resolveLanguageOptions,
    cachedLanguageOptions,
    probeAvailability,
    isUsableAvailability,
  };
});
