/**
 * 自动创新建议卡语言指令（直连 LLM 与云端 ChatCompletionsLLM 对齐）。
 * title/summary/detail 跟 UI locale；preview 文案跟页面原文语言。
 */
'use strict';

const PageAdvisorLocalePrompt = (() => {
  function normalize(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (s === 'en' || s.startsWith('en-') || s.startsWith('en_')) return 'en';
    return 'zh-CN';
  }

  function replyInstruction(raw) {
    if (normalize(raw) === 'en') {
      return [
        'Reply-language (locale=en): write title, summary, and detail in English.',
        'Keep JSON keys in English. Do not translate page URLs.',
        'preview.ops setText/value and user-visible setAttr values MUST match the language of the existing page content; do not translate the page into the UI locale.',
      ].join(' ');
    }
    return [
      '回复语言（locale=zh-CN）：title、summary、detail 必须使用简体中文。',
      'JSON 键名保持英文。不要翻译页面 URL。',
      'preview.ops 中 setText/value 以及用户可见的 setAttr 值必须与页面现有文案语言一致；不要把页面翻译成界面语言。',
    ].join('');
  }

  return { normalize, replyInstruction };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorLocalePrompt;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorLocalePrompt = PageAdvisorLocalePrompt;
}
