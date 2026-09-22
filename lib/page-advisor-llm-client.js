/**
 * OpenAI 兼容 chat/completions — 插件直连自动创新（与 taskPageAdvisor ChatCompletionsLLM 对齐）。
 */

'use strict';

if (typeof PageAdvisorLocalePrompt === 'undefined' && typeof require === 'function') {
  try { require('./page-advisor-locale-prompt.js'); } catch (_) { /* SW uses importScripts */ }
}

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

  const MAX_LLM_SNIPPET_LOG_CHARS = 500;

  function isJsonSpace(c) {
    return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
  }

  function matchJSONLiteral(s, i) {
    const lits = ['true', 'false', 'null'];
    for (let li = 0; li < lits.length; li++) {
      const lit = lits[li];
      if (s.slice(i, i + lit.length) !== lit) continue;
      const end = i + lit.length;
      if (end < s.length && /[A-Za-z0-9_]/.test(s[end])) return '';
      return lit;
    }
    return '';
  }

  function trimTrailingComma(out) {
    while (out.length && isJsonSpace(out[out.length - 1])) out.pop();
    if (out.length && out[out.length - 1] === ',') out.pop();
  }

  // Align with taskPageAdvisor/infrastructure/llm_parse.go repairLLMJSON.
  function repairLLMJSON(raw) {
    const s = String(raw || '');
    if (!s) return s;
    const out = [];
    const stack = [];
    let inString = false;
    let escape = false;
    let afterColon = false;
    let afterValue = false;
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (inString) {
        out.push(c);
        if (escape) {
          escape = false;
          i += 1;
          continue;
        }
        if (c === '\\') {
          escape = true;
          i += 1;
          continue;
        }
        if (c === '"') {
          inString = false;
          if (afterColon) {
            afterColon = false;
            afterValue = true;
          } else if (stack.length && stack[stack.length - 1] === '[') {
            afterValue = true;
          }
        }
        i += 1;
        continue;
      }
      if (isJsonSpace(c)) {
        out.push(c);
        i += 1;
        continue;
      }
      if (c === '"') {
        if (afterValue) {
          out.push(',');
          afterValue = false;
        }
        inString = true;
        out.push(c);
        i += 1;
        continue;
      }
      if (c === '{' || c === '[') {
        if (afterValue) {
          out.push(',');
          afterValue = false;
        }
        stack.push(c);
        afterColon = false;
        afterValue = false;
        out.push(c);
        i += 1;
        continue;
      }
      if (c === '}') {
        afterValue = false;
        if (stack.length && stack[stack.length - 1] === '{') stack.pop();
        trimTrailingComma(out);
        out.push(c);
        afterColon = false;
        afterValue = stack.length > 0;
        i += 1;
        continue;
      }
      if (c === ']') {
        afterValue = false;
        if (stack.length && stack[stack.length - 1] === '[') stack.pop();
        trimTrailingComma(out);
        out.push(c);
        afterColon = false;
        afterValue = stack.length > 0;
        i += 1;
        continue;
      }
      if (c === ':') {
        afterColon = true;
        afterValue = false;
        out.push(c);
        i += 1;
        continue;
      }
      if (c === ',') {
        afterColon = false;
        afterValue = false;
        out.push(c);
        i += 1;
        continue;
      }
      if (c === '-' || (c >= '0' && c <= '9')) {
        if (afterValue) {
          out.push(',');
          afterValue = false;
        }
        let j = i + 1;
        while (j < s.length) {
          const d = s[j];
          if ((d >= '0' && d <= '9') || d === '.' || d === 'e' || d === 'E' || d === '+' || d === '-') {
            j += 1;
            continue;
          }
          break;
        }
        out.push(s.slice(i, j));
        afterColon = false;
        afterValue = true;
        i = j;
        continue;
      }
      if (c === 't' || c === 'f' || c === 'n') {
        const lit = matchJSONLiteral(s, i);
        if (!lit) {
          out.push(c);
          i += 1;
          continue;
        }
        const inObject = stack.length && stack[stack.length - 1] === '{';
        if (afterValue && inObject) {
          i += lit.length;
          continue;
        }
        if (afterValue) {
          out.push(',');
          afterValue = false;
        }
        out.push(lit);
        afterColon = false;
        afterValue = true;
        i += lit.length;
        continue;
      }
      out.push(c);
      i += 1;
    }
    return out.join('');
  }

  function jsonParseOk(raw) {
    try {
      JSON.parse(raw);
      return true;
    } catch (_) {
      return false;
    }
  }

  function recoverableJSON(raw) {
    return jsonParseOk(raw) || jsonParseOk(repairLLMJSON(raw));
  }

  function balancedJSONAt(s, start) {
    if (start < 0 || start >= s.length) return '';
    const open = s[start];
    if (open !== '{' && open !== '[') return '';
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (c === '\\') {
          escape = true;
          continue;
        }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === '{' || c === '[') depth += 1;
      else if (c === '}' || c === ']') {
        if (depth > 0) depth -= 1;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
    return '';
  }

  function firstValidJSONPreferringArray(s) {
    let firstObj = '';
    let inString = false;
    let escape = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (c === '\\') {
          escape = true;
          continue;
        }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c !== '{' && c !== '[') continue;
      const slice = balancedJSONAt(s, i);
      if (!slice || !recoverableJSON(slice)) continue;
      if (slice[0] === '[') return slice;
      if (!firstObj) firstObj = slice;
    }
    return firstObj;
  }

  function extractJSONPayload(raw) {
    let s = String(raw || '').trim();
    if (s.startsWith('```')) {
      s = s.replace(/^```(?:json|JSON)?/, '');
      const last = s.lastIndexOf('```');
      if (last >= 0) s = s.slice(0, last);
      s = s.trim();
    }
    const slice = firstValidJSONPreferringArray(s);
    return slice || s;
  }

  function normalizeSuggestionItems(parsed) {
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

  function parseSuggestionsJSON(raw) {
    const payload = extractJSONPayload(raw);
    if (!String(payload || '').trim()) {
      throw new Error('parse suggestions json: empty payload');
    }
    const attempts = [payload];
    const repaired = repairLLMJSON(payload);
    if (repaired !== payload) attempts.push(repaired);
    let lastErr;
    for (let i = 0; i < attempts.length; i++) {
      try {
        return normalizeSuggestionItems(JSON.parse(attempts[i]));
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(`parse suggestions json: ${lastErr && lastErr.message ? lastErr.message : 'invalid json'}`);
  }

  function logSnippet(content, apiKey) {
    let s = String(content || '').trim();
    if (s.length > MAX_LLM_SNIPPET_LOG_CHARS) s = s.slice(0, MAX_LLM_SNIPPET_LOG_CHARS);
    const k = String(apiKey || '').trim();
    if (k) s = s.split(k).join('[redacted-api-key]');
    return s;
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

  function skillSystemContent(skill) {
    if (!skill) return '';
    if (typeof PageAdvisorPromptSkills !== 'undefined'
      && typeof PageAdvisorPromptSkills.buildSkillSystemContent === 'function') {
      return PageAdvisorPromptSkills.buildSkillSystemContent(skill);
    }
    const title = String(skill.title || '').trim() || 'untitled';
    return `## User skill: ${title}\n${String(skill.body || '')}`;
  }

  function localeSystemContent(locale) {
    if (typeof PageAdvisorLocalePrompt !== 'undefined'
      && typeof PageAdvisorLocalePrompt.replyInstruction === 'function') {
      return PageAdvisorLocalePrompt.replyInstruction(locale);
    }
    return '';
  }

  function buildChatMessages(page, skill, locale) {
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    const extra = skillSystemContent(skill);
    if (extra) {
      messages.push({ role: 'system', content: extra });
    }
    const locMsg = localeSystemContent(locale || page?.locale);
    if (locMsg) {
      messages.push({ role: 'system', content: locMsg });
    }
    messages.push({ role: 'user', content: buildPageAdvisorPrompt(page) });
    return messages;
  }

  /**
   * @param {{ apiKey: string, baseUrl: string, model: string }} creds
   * @param {{ url?: string, title?: string, pageText?: string, text?: string, truncated?: boolean, domOutline?: object[] }} page
   * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, skill?: { title?: string, body?: string }|null, locale?: string }} [opts]
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
          messages: buildChatMessages(page, opts.skill, opts.locale || page?.locale),
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
    try {
      return parseSuggestionsJSON(content);
    } catch (e) {
      console.warn('[taskChromePlugin] page_advisor_llm_json_parse_failed', {
        error: e && e.message ? e.message : String(e),
        model,
        content_len: String(content || '').length,
        content_snippet: logSnippet(content, apiKey),
      });
      throw e;
    }
  }

  return {
    SYSTEM_PROMPT,
    buildChatMessages,
    joinChatCompletionsURL,
    buildPageAdvisorPrompt,
    parseSuggestionsJSON,
    extractChatContent,
    extractJSONPayload,
    repairLLMJSON,
    suggest,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorLLM;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorLLM = PageAdvisorLLM;
}
