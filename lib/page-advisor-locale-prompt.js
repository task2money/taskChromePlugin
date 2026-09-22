/**
 * 自动创新建议卡语言指令（直连 LLM 与云端 ChatCompletionsLLM 对齐）。
 * title/summary/detail 跟 UI locale；preview 文案跟页面原文语言。
 * locale=en 时同时提供整段英译 SYSTEM_PROMPT（OPT-20260922-038）。
 */
'use strict';

const PageAdvisorLocalePrompt = (() => {
  function normalize(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (s === 'en' || s.startsWith('en-') || s.startsWith('en_')) return 'en';
    return 'zh-CN';
  }

  /**
   * locale=en 时替换内置（中文）SYSTEM_PROMPT 的英译本，其余 locale 返回 ''（沿用调用方默认）。
   * 与 taskPageAdvisor/infrastructure/page_advisor_prompt.go 的 pageAdvisorSystemPromptEN 对齐：
   * JSON 契约 / nid 锚定 / preview.ops 白名单逐条等同，仅叙述语言不同。
   */
  const SYSTEM_PROMPT_EN = [
    'You are a web experience and accessibility optimization advisor. Using the page context and DOM outline (nid) supplied by the user, output at most 8 actionable optimization suggestions.',
    'Output JSON only (no markdown fences), in this shape:',
    '[{"id":"s1","title":"...","summary":"...","detail":"...","category":"a11y|ux|perf|seo|copy|other","target_nid":"n12","anchor_text":"visible copy snippet","preview":{"ops":[{"op":"setText","nid":"n12","value":"new copy"}]}}]',
    'preview.ops allows only: setText|setAttr|setStyle|addClass|hide|insertAdjacent.',
    'addClass values MUST start with taskplugin-preview-; setAttr allows only aria-* / title / placeholder / alt / href / role.',
    'Anchor every suggestion to a nid that really exists in dom_outline where possible; omit preview when you cannot. Never invent generic slogans unrelated to the page.',
  ].join('\n');

  function systemPromptOverride(raw) {
    return normalize(raw) === 'en' ? SYSTEM_PROMPT_EN : '';
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

  return { normalize, replyInstruction, systemPromptOverride };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorLocalePrompt;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorLocalePrompt = PageAdvisorLocalePrompt;
}
