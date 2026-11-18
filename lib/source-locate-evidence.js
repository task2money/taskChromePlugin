/**
 * Build source-locate evidence from an Element or a frozen suggestion anchor.
 *
 * Never reads form values. Sensitive (password-like) inputs keep only
 * testid / id / name. Pure DOM attribute access; no chrome API.
 */

'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  const MAX_ELEMENTS = 5;
  const MAX_EVIDENCE = 24;
  const MAX_TEXT = 40;
  const TESTID_ATTRS = ['data-testid', 'data-test', 'data-cy'];
  const FRAMEWORK_PREFIXES = ['data-v-', '_ngcontent-', '_nghost-'];

  function locateModule() {
    if (global.SourceMapLocate) return global.SourceMapLocate;
    if (typeof require === 'function') {
      try { return require('./source-map-locate.js'); } catch (_) { /* content script */ }
    }
    return null;
  }

  function attr(el, name) {
    try {
      return el && typeof el.getAttribute === 'function' ? el.getAttribute(name) : null;
    } catch (_) {
      return null;
    }
  }

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function collapse(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isSensitiveElement(el) {
    const tag = String(el && el.tagName || '').toLowerCase();
    if (tag !== 'input') return false;
    const type = text(attr(el, 'type')).toLowerCase();
    return type === 'password'
      || /password|passwd|pwd/i.test(text(attr(el, 'name')))
      || /password|passwd|pwd/i.test(text(el && el.id));
  }

  function attributeNames(el) {
    if (!el) return [];
    if (Array.isArray(el.attributes)) {
      return el.attributes.map((a) => String(a && a.name || '')).filter(Boolean);
    }
    if (typeof el.getAttributeNames === 'function') {
      try { return el.getAttributeNames(); } catch (_) { return []; }
    }
    return [];
  }

  function isFrameworkAttr(name) {
    const n = String(name || '');
    return FRAMEWORK_PREFIXES.some((p) => n.startsWith(p));
  }

  function parseClassTokensFromHtmlSnippet(html) {
    const out = [];
    const seen = new Set();
    const re = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    let m;
    const source = String(html || '');
    while ((m = re.exec(source))) {
      const tokens = String(m[1] || m[2] || '').split(/\s+/);
      for (const raw of tokens) {
        const token = raw.trim();
        if (!token || token.startsWith('taskplugin-') || seen.has(token)) continue;
        seen.add(token);
        out.push(token.slice(0, 200));
      }
    }
    return out;
  }

  function parseFrameworkAttrNames(html) {
    const out = [];
    const seen = new Set();
    const re = /\b(data-v-[A-Za-z0-9_-]+|_ngcontent-[A-Za-z0-9_-]+|_nghost-[A-Za-z0-9_-]+)\s*=/g;
    let m;
    const source = String(html || '');
    while ((m = re.exec(source))) {
      const name = m[1];
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
    return out;
  }

  function parseIdFromHtml(html) {
    const m = /\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/i.exec(String(html || ''));
    return m ? String(m[1] || m[2] || '').trim().slice(0, 200) : '';
  }

  function dedupe(list) {
    const out = [];
    const seen = new Set();
    for (const item of list) {
      const value = text(item && item.value);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push({ kind: item.kind, value });
    }
    return out;
  }

  function classTokens(el) {
    const raw = typeof el.className === 'string'
      ? el.className
      : text(attr(el, 'class'));
    const out = [];
    const seen = new Set();
    for (const token of String(raw || '').split(/\s+/)) {
      const t = token.trim();
      if (!t || t.length < 2 || t.startsWith('taskplugin-') || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }

  function evidenceFromElement(el, opts) {
    if (!el || el.nodeType !== 1) return [];
    const sensitive = isSensitiveElement(el);
    const tag = String(el.tagName || '').toLowerCase();
    const out = [];
    const push = (kind, value) => {
      const v = text(value);
      if (v) out.push({ kind, value: v.slice(0, 200) });
    };

    for (const name of TESTID_ATTRS) push('testid', attr(el, name));
    push('id', el.id || attr(el, 'id'));
    push('name', attr(el, 'name'));

    if (!sensitive) {
      push('aria', attr(el, 'aria-label'));
      push('name', attr(el, 'placeholder'));
      push('name', attr(el, 'alt'));
      push('name', attr(el, 'autocomplete'));
      const href = text(attr(el, 'href'));
      if (tag === 'a' && href && !/^javascript:/i.test(href)) push('name', href);
      for (const token of classTokens(el)) push('class', token);
      for (const name of attributeNames(el)) {
        if (isFrameworkAttr(name)) push('framework', name);
      }
      if (tag !== 'input' && tag !== 'textarea') {
        push('text', collapse(el.textContent || '').slice(0, MAX_TEXT));
      }
    }

    return dedupe(out).slice(0, MAX_EVIDENCE);
  }

  function evidenceFromSuggestion(sug) {
    if (!sug || typeof sug !== 'object') return [];
    const out = [];
    const push = (kind, value) => {
      const v = text(value);
      if (v) out.push({ kind, value: v.slice(0, 200) });
    };
    const html = text(sug.html_snippet);
    push('testid', sug.testid);
    push('id', sug.dom_id || parseIdFromHtml(html));
    push('aria', sug.aria_label);
    for (const token of parseClassTokensFromHtmlSnippet(html)) push('class', token);
    for (const name of parseFrameworkAttrNames(html)) push('framework', name);
    push('text', sug.visible_text || sug.anchor_text || sug.outline_text);
    return dedupe(out).slice(0, MAX_EVIDENCE);
  }

  function collectForElements(elements, opts) {
    const list = Array.isArray(elements) ? elements : [];
    return list.slice(0, MAX_ELEMENTS).map((el) => evidenceFromElement(el, opts));
  }

  function escapeVariants(value) {
    const locate = locateModule();
    if (locate && typeof locate.escapeVariants === 'function') {
      return locate.escapeVariants(value);
    }
    const raw = String(value || '');
    return raw ? [raw] : [];
  }

  const SourceLocateEvidence = {
    MAX_ELEMENTS,
    MAX_EVIDENCE,
    collectForElements,
    evidenceFromElement,
    evidenceFromSuggestion,
    parseClassTokensFromHtmlSnippet,
    parseFrameworkAttrNames,
    escapeVariants,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SourceLocateEvidence;
  }
  global.SourceLocateEvidence = SourceLocateEvidence;
}(typeof globalThis !== 'undefined' ? globalThis : this));
}
