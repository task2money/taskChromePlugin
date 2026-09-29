/**
 * 采集时冻结的页面锚点（id / testid / 地标 / 辅助 nth-child 路径）。
 * 路径只作辅助；与 id 或 data-testid 冲突时以 id / testid 为准。
 */

'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {
  const PA_ANCHOR_LANDMARK_TAGS = new Set([
    'MAIN', 'NAV', 'HEADER', 'FOOTER', 'FORM', 'ASIDE',
  ]);

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

  function pageAdvisorDomAnchor(el) {
    if (!el || el.nodeType !== 1) return {};
    const testid = paAnchorAttr(el, 'data-testid')
      || paAnchorAttr(el, 'data-test')
      || paAnchorAttr(el, 'data-cy');
    return {
      id: String(el.id || paAnchorAttr(el, 'id') || ''),
      testid,
      aria_label: paAnchorAttr(el, 'aria-label'),
      landmark: pageAdvisorLandmark(el),
      css_path: pageAdvisorCssPath(el),
    };
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
        ancestor_nids: paAnchorAncestors(nid, byNid),
        outline_text: node.text || '',
      };
    });
  }

  const PageAdvisorAnchor = {
    pageAdvisorLandmark,
    pageAdvisorCssPath,
    pageAdvisorDomAnchor,
    attachSuggestionAnchors,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PageAdvisorAnchor;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.PageAdvisorAnchor = PageAdvisorAnchor;
    globalThis.pageAdvisorDomAnchor = pageAdvisorDomAnchor;
    globalThis.attachSuggestionAnchors = attachSuggestionAnchors;
  }
}
