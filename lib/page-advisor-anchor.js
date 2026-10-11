/**
 * 采集时冻结的页面锚点（id / testid / 地标 / 选择器路径 / 元素标签 / HTML 片段）。
 * 优先复用 ElementPicker 的标签与 CSS 路径（与 Alt+X 指针选择一致）；路径只作辅助；
 * 与 id 或 data-testid 冲突时以 id / testid 为准。
 */

'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {
  const PA_ANCHOR_LANDMARK_TAGS = new Set([
    'MAIN', 'NAV', 'HEADER', 'FOOTER', 'FORM', 'ASIDE',
  ]);
  const PA_ANCHOR_HTML_MAX = 240;
  const PA_ANCHOR_TEXT_MAX = 120;

  function paResolveElementPicker() {
    if (globalThis.ElementPicker) return globalThis.ElementPicker;
    if (typeof require === 'function') {
      try { return require('./element-picker.js'); } catch (_) { /* content script */ }
    }
    return null;
  }

  function paStripPluginClassTokens(text) {
    return String(text || '')
      .replace(/(^|[\s"'])taskplugin-[a-zA-Z0-9_-]+/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+"/g, '"')
      .replace(/class="\s+/g, 'class="')
      .replace(/class="\s*"/g, '')
      .trim();
  }

  function paAnchorClip(text, max) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    const chars = Array.from(s);
    if (chars.length <= max) return s;
    return chars.slice(0, max).join('');
  }

  function paAnchorElementChildren(parent) {
    if (!parent) return [];
    if (parent.children && typeof parent.children.length === 'number') {
      return Array.from(parent.children);
    }
    const nodes = parent.childNodes || [];
    return Array.from(nodes).filter((n) => n && n.nodeType === 1);
  }

  function paAnchorAttr(el, name) {
    if (!el || typeof el.getAttribute !== 'function') return '';
    const v = el.getAttribute(name);
    return v == null ? '' : String(v);
  }

  function paRawClassName(el) {
    if (typeof el.className === 'string') return el.className;
    return paAnchorAttr(el, 'class');
  }

  function pageAdvisorLandmark(el) {
    let headingTag = '';
    let headingText = '';
    let landmarkTag = '';
    let landmarkLabel = '';
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const tag = String(cur.tagName || '').toUpperCase();
      if (!headingText && /^H[1-6]$/.test(tag)) {
        headingTag = tag.toLowerCase();
        headingText = paAnchorClip(cur.textContent, 40);
      }
      const role = paAnchorAttr(cur, 'role').toLowerCase();
      if (!landmarkTag && (PA_ANCHOR_LANDMARK_TAGS.has(tag) || role === 'main' || role === 'navigation')) {
        landmarkTag = tag.toLowerCase();
        landmarkLabel = paAnchorClip(paAnchorAttr(cur, 'aria-label'), 40);
      }
      if (tag === 'BODY' || tag === 'HTML') break;
      cur = cur.parentElement;
    }
    if (landmarkTag && headingText) return `${landmarkTag} > ${headingTag}「${headingText}」`;
    if (landmarkTag) return landmarkLabel ? `${landmarkTag}「${landmarkLabel}」` : landmarkTag;
    if (headingText) return `${headingTag}「${headingText}」`;
    return '';
  }

  function pageAdvisorCssPath(el) {
    const parts = [];
    let cur = el;
    const stop = new Set(['BODY', 'MAIN', 'NAV', 'HEADER', 'FOOTER', 'FORM']);
    while (cur && cur.nodeType === 1 && parts.length < 24) {
      const tag = String(cur.tagName || '').toUpperCase();
      if (!tag || tag === 'HTML') break;
      const kids = paAnchorElementChildren(cur.parentElement);
      const nth = Math.max(1, kids.indexOf(cur) + 1);
      const role = paAnchorAttr(cur, 'role').toLowerCase();
      const isStop = stop.has(tag) || role === 'main';
      parts.push(isStop ? tag.toLowerCase() : `${tag.toLowerCase()}:nth-child(${nth})`);
      if (isStop) break;
      cur = cur.parentElement;
    }
    return parts.slice(0, 8).reverse().join(' > ');
  }

  function paFallbackLabel(el) {
    const EP = paResolveElementPicker();
    const parts = {
      tagName: el.tagName,
      id: el.id || paAnchorAttr(el, 'id'),
      className: paRawClassName(el),
    };
    if (EP && typeof EP.buildElementLabel === 'function') {
      return EP.buildElementLabel(parts);
    }
    const tag = String(parts.tagName || 'element').toLowerCase() || 'element';
    const id = String(parts.id || '');
    const classes = String(parts.className || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((c) => `.${c}`)
      .join('');
    return `${tag}${id ? `#${id}` : ''}${classes}`;
  }

  function paFallbackVisibleText(el) {
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      return paAnchorClip(paAnchorAttr(el, 'placeholder') || el.value || '', PA_ANCHOR_TEXT_MAX);
    }
    if (tag === 'IMG') {
      return paAnchorClip(paAnchorAttr(el, 'alt'), PA_ANCHOR_TEXT_MAX);
    }
    return paAnchorClip(el.textContent, PA_ANCHOR_TEXT_MAX);
  }

  function paFallbackHtmlSnippet(el) {
    if (typeof el.outerHTML !== 'string') return '';
    return paStripPluginClassTokens(paAnchorClip(el.outerHTML, PA_ANCHOR_HTML_MAX));
  }

  function pageAdvisorDomAnchor(el) {
    if (!el || el.nodeType !== 1) return {};
    const testid = paAnchorAttr(el, 'data-testid')
      || paAnchorAttr(el, 'data-test')
      || paAnchorAttr(el, 'data-cy');
    const base = {
      id: String(el.id || paAnchorAttr(el, 'id') || ''),
      testid,
      aria_label: paAnchorAttr(el, 'aria-label'),
      landmark: pageAdvisorLandmark(el),
      css_path: pageAdvisorCssPath(el),
      label: paFallbackLabel(el),
      visible_text: paFallbackVisibleText(el),
      html_snippet: paFallbackHtmlSnippet(el),
    };

    const EP = paResolveElementPicker();
    if (!EP || typeof EP.snapshotElement !== 'function') return base;
    try {
      const snap = EP.snapshotElement(el);
      const label = String(snap.label || base.label || '');
      let cssPath = String(snap.cssPath || base.css_path || '');
      cssPath = paStripPluginClassTokens(cssPath).replace(/\.(?=\s|>|$)/g, '');
      return {
        ...base,
        label: label || base.label,
        css_path: cssPath || base.css_path,
        visible_text: String(snap.visibleText || base.visible_text || ''),
        html_snippet: paStripPluginClassTokens(
          String(snap.outerHtmlSnippet || base.html_snippet || ''),
        ),
      };
    } catch (_) {
      return base;
    }
  }

  function paAnchorAncestors(nid, byNid) {
    const out = [];
    const seen = new Set();
    let cur = byNid.get(String(nid || ''));
    while (cur && cur.parent_nid && out.length < 12) {
      const parent = String(cur.parent_nid);
      if (seen.has(parent)) break;
      seen.add(parent);
      out.push(parent);
      cur = byNid.get(parent);
    }
    return out;
  }

  function attachSuggestionAnchors(items, outline) {
    const list = Array.isArray(items) ? items : [];
    const nodes = Array.isArray(outline) ? outline : [];
    const byNid = new Map();
    for (const n of nodes) {
      if (n && n.nid != null && String(n.nid)) byNid.set(String(n.nid), n);
    }
    if (!byNid.size) return list;
    return list.map((it) => {
      const nid = String(it?.target_nid || '');
      const node = byNid.get(nid);
      if (!node) return it;
      return {
        ...it,
        tag: node.tag || it.tag || '',
        dom_id: node.id || '',
        testid: node.testid || '',
        aria_label: node.aria_label || '',
        landmark: node.landmark || '',
        css_path: node.css_path || '',
        label: node.label || '',
        visible_text: node.visible_text || node.text || '',
        html_snippet: node.html_snippet || '',
        ancestor_nids: paAnchorAncestors(nid, byNid),
        outline_text: node.text || '',
      };
    });
  }

  function ensureOfflineNid(el) {
    if (!el || typeof el.getAttribute !== 'function') return '';
    const existing = String(el.getAttribute('data-taskplugin-nid') || '');
    if (existing) return existing;
    if (typeof el.setAttribute !== 'function') return '';
    globalThis.__taskpluginOfflineNid = (globalThis.__taskpluginOfflineNid || 0) + 1;
    const nid = `off${globalThis.__taskpluginOfflineNid}`;
    el.setAttribute('data-taskplugin-nid', nid);
    return nid;
  }

  function suggestionHasDurableAnchor(sug) {
    if (!sug || typeof sug !== 'object') return false;
    return ['dom_id', 'testid', 'css_path', 'visible_text', 'anchor_text'].some(
      (key) => String(sug[key] || '').trim(),
    );
  }

  function paCssAttr(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function findOfflineAnchorElement(root, sug) {
    if (!root || !sug) return null;
    const domId = String(sug.dom_id || '').trim();
    if (domId && typeof root.getElementById === 'function') {
      const byId = root.getElementById(domId);
      if (byId) return byId;
    }
    const testid = String(sug.testid || '').trim();
    if (testid && typeof root.querySelector === 'function') {
      const byTest = root.querySelector(`[data-testid="${paCssAttr(testid)}"]`);
      if (byTest) return byTest;
    }
    const cssPath = String(sug.css_path || '').trim();
    if (cssPath && typeof root.querySelector === 'function') {
      try {
        const byPath = root.querySelector(cssPath);
        if (byPath) return byPath;
      } catch (_) { /* invalid selector from an old row */ }
    }
    const needle = String(sug.anchor_text || sug.visible_text || '').trim();
    if (needle && typeof root.querySelectorAll === 'function') {
      const nodes = root.querySelectorAll('[data-taskplugin-nid]');
      for (const node of nodes) {
        const text = String(node.textContent || '');
        if (text.includes(needle)) return node;
      }
    }
    return null;
  }

  /**
   * Bind saved offline anchors to this visit's nids.
   * Only the newest anchored row is shown. Older rows stay stored.
   * @param {object[]} items
   * @param {Document|Element} [doc]
   * @returns {{ hadAnchors: boolean, suggestions: object[] }}
   */
  function rebindOfflineSuggestions(items, doc) {
    const list = Array.isArray(items) ? items : [];
    const anchored = list.filter((item) => (
      Array.isArray(item?.suggestions) && item.suggestions.some(suggestionHasDurableAnchor)
    ));
    if (!anchored.length) return { hadAnchors: false, suggestions: [] };
    const root = doc || (typeof document !== 'undefined' ? document : null);
    if (root && globalThis.PageContext && typeof globalThis.PageContext.stampDomNids === 'function') {
      globalThis.PageContext.stampDomNids(root);
    }
    const suggestions = [];
    const latest = anchored[anchored.length - 1];
    for (const sug of latest.suggestions || []) {
      if (!suggestionHasDurableAnchor(sug)) continue;
      const el = findOfflineAnchorElement(root, sug);
      const nid = ensureOfflineNid(el);
      if (!nid) continue;
      suggestions.push({
        ...sug,
        id: String(sug.id || latest.id || 's1'),
        target_nid: nid,
      });
    }
    return { hadAnchors: true, suggestions };
  }

  const PageAdvisorAnchor = {
    pageAdvisorLandmark,
    pageAdvisorCssPath,
    pageAdvisorDomAnchor,
    attachSuggestionAnchors,
    rebindOfflineSuggestions,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PageAdvisorAnchor;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.PageAdvisorAnchor = PageAdvisorAnchor;
    globalThis.pageAdvisorDomAnchor = pageAdvisorDomAnchor;
    globalThis.attachSuggestionAnchors = attachSuggestionAnchors;
    globalThis.rebindOfflineSuggestions = rebindOfflineSuggestions;
  }
}
