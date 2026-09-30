/**
 * Chrome 内置 Prompt API 的文本语言选项只构造一次。
 * availability / create / prompt 必须收到同一对象，否则 Chrome 会把可用性判错。
 * 界面语言走 PageAdvisorLocalePrompt：en / en-* 为 en，其余为 zh。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.PageAdvisorBuiltinPrompt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function pageAdvisorBuiltinPromptFactory() {
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

  /**
   * 对同一组语言选项调用 availability、create、prompt。
   * 可用性不是 available 时不创建会话。
   */
  async function run(languageModel, locale, text) {
    if (!languageModel || typeof languageModel.availability !== 'function' || typeof languageModel.create !== 'function') {
      return { availability: 'unavailable', result: '' };
    }
    const options = languageOptions(locale);
    const availability = await languageModel.availability(options);
    if (availability !== 'available') {
      return { availability, result: '', options };
    }
    const session = await languageModel.create(options);
    try {
      const result = typeof session.prompt === 'function' ? await session.prompt(text, options) : '';
      return { availability, result, options };
    } finally {
      if (session && typeof session.destroy === 'function') {
        session.destroy();
      }
    }
  }

  return { promptLanguage, languageOptions, run };
});
