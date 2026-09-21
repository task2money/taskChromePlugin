/**
 * OpenAI 兼容 chat/completions — 插件直连自动创新（与 taskPageAdvisor ChatCompletionsLLM 对齐）。
 */

'use strict';

const PageAdvisorLLM = (() => {
  const SYSTEM_PROMPT = '你是网页体验与可访问性优化顾问。根据用户提供的页面上下文与 DOM 大纲（nid），输出最多 8 条可执行优化建议。\n必须只输出 JSON（不要 markdown 围栏），格式为：\n[{"id":"s1","title":"...","summary":"...","detail":"...","category":"a11y|ux|perf|seo|copy|other","target_nid":"n12","anchor_text":"可见文案片段","preview":{"ops":[{"op":"setText","nid":"n12","value":"新文案"}]}}]\npreview.ops 仅允许: setText|setAttr|setStyle|addClass|hide|insertAdjacent。\naddClass 的 value 必须以 taskplugin-preview- 开头；setAttr 仅 aria-* / title / placeholder / alt / href / role。\n每条建议尽量绑定 dom_outline 中真实存在的 nid；无法绑定时可省略 preview。禁止编造与页面无关的通用口号。';

  const MAX_SUGGESTIONS = 8;

  function joinChatCompletionsURL(baseURL) {
    const u = String(baseURL || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (u.endsWith('/chat/completions')) return u;
    if (u.endsWith('/v1')) return `${u}/chat/completions`;
    return `${u}/v1/chat/completions`;
  }

  function buildPageAdvisorPrompt(page) {
    const parts = [
      `页面 URL: ${page?.url || ''}`,
      `标题: ${page?.title || ''}`,
    ];
    if (page?.truncated) parts.push('(正文已截断)');
    parts.push('', '可见文本:', String(page?.pageText || page?.text || ''));
    const outline = Array.isArray(page?.domOutline) ? page.domOutline : [];
    if (outline.length) {
      parts.push('', 'DOM 大纲 (JSON，请用 nid 锚定预览):', JSON.stringify(outline));
    }
    return parts.join('\n');
  }

  function extractJSONPayload(raw) {
    let s = String(raw || '').trim();
    if (s.startsWith('```')) {
      s = s.replace(/^```(?:json|JSON)?/, '');
      const last = s.lastIndexOf('```');
      if (last >= 0) s = s.slice(0, last);
      s = s.trim();
    }
    const arrStart = s.indexOf('[');
    const objStart = s.indexOf('{');
    if (arrStart >= 0 && (objStart < 0 || arrStart < objStart)) {
      const end = s.lastIndexOf(']');
      if (end > arrStart) return s.slice(arrStart, end + 1);
    }
    if (objStart >= 0) {
      const end = s.lastIndexOf('}');
      if (end > objStart) return s.slice(objStart, end + 1);
    }
    return s;
  }

  function parseSuggestionsJSON(raw) {
    const payload = extractJSONPayload(raw);
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (e) {
      throw new Error(`parse suggestions json: ${e.message}`);
    }
    let items = Array.isArray(parsed) ? parsed : parsed?.suggestions;
    if (!Array.isArray(items)) {
      throw new Error('parse suggestions json: expected array');
    }
    if (items.length > MAX_SUGGESTIONS) items = items.slice(0, MAX_SUGGESTIONS);
    return items.map((it, i) => ({
      id: String(it?.id || `s${i + 1}`),
      title: String(it?.title || ''),
      summary: String(it?.summary || ''),
      detail: String(it?.detail || ''),
      category: String(it?.category || 'other'),
      target_nid: it?.target_nid || it?.targetNid || '',
      anchor_text: it?.anchor_text || it?.anchorText || '',
      preview: it?.preview || undefined,
    })).filter((it) => it.title || it.summary || it.detail);
  }

  function extractChatContent(body) {
    let wrap;
    try {
      wrap = typeof body === 'string' ? JSON.parse(body) : body;
    } catch (e) {
      throw new Error(`decode chat response: ${e.message}`);
    }
    if (wrap?.error?.message) {
      throw new Error(`llm error: ${wrap.error.message}`);
    }
    const content = wrap?.choices?.[0]?.message?.content;
    if (!String(content || '').trim()) {
      throw new Error('llm returned empty content');
    }
    return content;
  }

  /**
   * @param {{ apiKey: string, baseUrl: string, model: string }} creds
   * @param {{ url?: string, title?: string, pageText?: string, text?: string, truncated?: boolean, domOutline?: object[] }} page
   * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
   */
  async function suggest(creds, page, opts = {}) {
    const apiKey = String(creds?.apiKey || '').trim();
    const baseUrl = String(creds?.baseUrl || '').trim();
    const model = String(creds?.model || '').trim();
    if (!apiKey || !baseUrl || !model) {
      throw new Error('llm credentials incomplete (need api_key, base_url, model)');
    }
    const endpoint = joinChatCompletionsURL(baseUrl);
    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    const timeoutMs = opts.timeoutMs ?? 60000;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildPageAdvisorPrompt(page) },
          ],
        }),
        signal: ctrl?.signal,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`llm http ${res.status}: ${String(text).slice(0, 240)}`);
    }
    const content = extractChatContent(text);
    return parseSuggestionsJSON(content);
  }

  return {
    SYSTEM_PROMPT,
    joinChatCompletionsURL,
    buildPageAdvisorPrompt,
    parseSuggestionsJSON,
    extractChatContent,
    extractJSONPayload,
    suggest,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorLLM;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorLLM = PageAdvisorLLM;
}
