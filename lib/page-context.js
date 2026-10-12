/**
 * 页面上下文采集（纯函数优先）— Alt+Z 页面优化建议。
 * 提取可见可读文本（跳过 script/style/隐藏节点），并做长度截断。
 */

'use strict';

/** 与 taskPageAdvisor domain.MaxPageTextRunes 对齐（32KiB 字符） */
if (!globalThis.__taskpluginContentBoot?.skip) {
if (typeof pageAdvisorDomAnchor !== 'function' && typeof require === 'function') {
  try { require('./page-advisor-anchor.js'); } catch (_) { /* content script loads the file */ }
}
if (typeof globalThis.PageContextElements === 'undefined' && typeof require === 'function') {
  try { require('./page-context-elements.js'); } catch (_) { /* content script loads the file */ }
}
if (typeof globalThis.PageAdvisorScope === 'undefined' && typeof require === 'function') {
  try { require('./page-advisor-scope.js'); } catch (_) { /* content script loads the file */ }
}
if (typeof globalThis.PageContextRect === 'undefined' && typeof require === 'function') {
  try { require('./page-context-rect.js'); } catch (_) { /* content script loads the file */ }
}
const MAX_PAGE_TEXT_RUNES = 32 * 1024;
/** 与 taskPageAdvisor domain.MaxDomOutlineNodes 对齐 */
const MAX_DOM_OUTLINE_NODES = 200;
const NID_ATTR = 'data-taskplugin-nid';

// OPT-20261007-006：大纲整段进 LLM 提示，逐节点长度必须封顶。anchor 已把
// html_snippet 截到 PA_ANCHOR_HTML_MAX（240 rune），但 label 由原始 class 拼成、
// aria-label 取自属性，都没有上限 —— class 密集的页面能把 200 节点大纲撑到数万字符。
const MAX_OUTLINE_LABEL_CHARS = 120;
const MAX_OUTLINE_ARIA_CHARS = 120;
const MAX_OUTLINE_HTML_SNIPPET_CHARS = 240;

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME',
  'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED',
]);

const OUTLINE_TAGS = new Set([
  'A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL', 'H1', 'H2', 'H3', 'H4',
  'H5', 'H6', 'P', 'LI', 'IMG', 'NAV', 'HEADER', 'FOOTER', 'MAIN', 'SECTION',
  'ARTICLE', 'FORM', 'TABLE', 'TH', 'TD', 'SUMMARY', 'DETAILS',
]);

/**
 * 按 Unicode 字符（rune）截断，与服务端 TruncatePageText 语义一致。
 * @param {string} text
 * @param {number} [maxRunes]
 * @returns {{ text: string, truncated: boolean }}
 */
function truncatePageText(text, maxRunes = MAX_PAGE_TEXT_RUNES) {
  const s = String(text || '');
  const limit = Math.max(0, Number(maxRunes) || 0);
  const runes = Array.from(s);
  if (runes.length <= limit) {
    return { text: s, truncated: false };
  }
  return { text: runes.slice(0, limit).join(''), truncated: true };
}

/**
 * 插件自身 chrome（浮窗 / 框选 overlay / 旧 root）——采集页上下文时一律跳过，
 * 避免 Alt+Z / Alt+Shift+Z 把悬浮面板文案当成宿主页内容去「优化」。
 * @param {Element} el
 * @returns {boolean}
 */
function isPluginChromeUi(el) {
  if (!el || el.nodeType !== 1) return false;
  const id = el.id || '';
  if (
    id === 'taskplugin-root'
    || id === 'taskplugin-float-root'
    || id === 'taskplugin-region-select-overlay'
    || id === 'taskplugin-page-advisor-layer'
  ) {
    return true;
  }
  if (typeof el.closest === 'function') {
    if (
      el.closest('#taskplugin-root')
      || el.closest('#taskplugin-float-root')
      || el.closest('#taskplugin-region-select-overlay')
      || el.closest('#taskplugin-page-advisor-layer')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 元素是否应跳过（标签 / hidden / aria-hidden / 显式 display|visibility）。
 * @param {Element} el
 * @returns {boolean}
 */
function isElementSkipped(el) {
  if (!el || el.nodeType !== 1) return true;
  if (isPluginChromeUi(el)) return true;
  const tag = String(el.tagName || '').toUpperCase();
  if (SKIP_TAGS.has(tag)) return true;
  if (el.hidden === true) return true;
  if (typeof el.getAttribute === 'function' && el.getAttribute('aria-hidden') === 'true') {
    return true;
  }
  const style = el.style;
  if (style) {
    const display = String(style.display || '').toLowerCase();
    const visibility = String(style.visibility || '').toLowerCase();
    if (display === 'none' || visibility === 'hidden') return true;
  }
  if (typeof getComputedStyle === 'function') {
    try {
      const view = el.ownerDocument?.defaultView;
      const cs = view ? view.getComputedStyle(el) : getComputedStyle(el);
      if (cs) {
        if (cs.display === 'none' || cs.visibility === 'hidden') return true;
        if (cs.opacity === '0') return true;
      }
    } catch (_) { /* jsdom / detached */ }
  }
  return false;
}

/**
 * 从 DOM 根提取可见可读文本（去噪）。
 * @param {Node} [root]
 * @returns {string}
 */
function extractVisibleReadableText(root) {
  if (!root) return '';
  const parts = [];

  function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) {
      const t = String(node.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (t) parts.push(t);
      return;
    }
    if (node.nodeType !== 1) return;
    if (isElementSkipped(node)) return;
    const children = node.childNodes || [];
    for (let i = 0; i < children.length; i += 1) {
      walk(children[i]);
    }
  }

  walk(root);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * 采集当前页上下文：{ url, title, pageText }（pageText 已截断）。
 * @param {{ url?: string, title?: string, root?: Node, maxRunes?: number, stampNids?: boolean }} [opts]
 * @returns {{ url: string, title: string, pageText: string, pageTextTruncated: boolean, domOutline: object[] }}
 */
function capturePageContext(opts = {}) {
  let url = opts.url;
  let title = opts.title;
  let root = opts.root;

  if (url == null && typeof location !== 'undefined') {
    url = location.href;
  }
  if (title == null && typeof document !== 'undefined') {
    title = document.title;
  }
  if (root == null && typeof document !== 'undefined') {
    root = document.body || document.documentElement;
  }

  const stamp = opts.stampNids !== false;
  if (stamp && root && typeof root.querySelectorAll === 'function') {
    stampDomNids(root);
  }

  const raw = extractVisibleReadableText(root);
  const { text, truncated } = truncatePageText(raw, opts.maxRunes);
  const domOutline = captureDomOutline(root, opts.maxOutlineNodes);
  return {
    url: String(url || ''),
    title: String(title || ''),
    pageText: text,
    pageTextTruncated: truncated,
    domOutline,
  };
}

/**
 * 给可见可交互/文本节点打会话 nid（幂等：已有属性则保留）。
 * @param {Element|Document} root
 * @returns {number} stamped count
 */
function stampDomNids(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  const scope = root.nodeType === 9 ? root.body || root.documentElement : root;
  if (!scope) return 0;
  let n = 0;
  const stack = [scope];
  while (stack.length && n < MAX_DOM_OUTLINE_NODES) {
    const el = stack.pop();
    if (!el || el.nodeType !== 1) continue;
    if (isElementSkipped(el)) continue;
    const tag = String(el.tagName || '').toUpperCase();
    const role = typeof el.getAttribute === 'function' ? (el.getAttribute('role') || '') : '';
    const interesting = OUTLINE_TAGS.has(tag)
      || role
      || (typeof el.getAttribute === 'function' && el.getAttribute('contenteditable') === 'true');
    if (interesting) {
      const existing = typeof el.getAttribute === 'function' ? el.getAttribute(NID_ATTR) : null;
      if (!existing && typeof el.setAttribute === 'function') {
        const Scope = globalThis.PageAdvisorScope;
        const nid = Scope && typeof Scope.allocateDomNid === 'function'
          ? Scope.allocateDomNid(el, NID_ATTR)
          : `n${n + 1}`;
        el.setAttribute(NID_ATTR, nid);
      }
      n += 1;
    }
    const children = el.children || el.childNodes || [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]);
    }
  }
  return n;
}

/**
 * @param {Element|Document|null} root
 * @param {number} [maxNodes]
 * @returns {{ nid: string, tag: string, role: string, text: string, parent_nid: string }[]}
 */
function clipOutlineField(value, maxChars) {
  const s = String(value || '');
  const chars = Array.from(s);
  if (chars.length <= maxChars) return s;
  return chars.slice(0, maxChars).join('');
}

function captureDomOutline(root, maxNodes = MAX_DOM_OUTLINE_NODES) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  const limit = Math.max(0, Number(maxNodes) || MAX_DOM_OUTLINE_NODES);
  const nodes = root.querySelectorAll(`[${NID_ATTR}]`);
  const out = [];
  for (let i = 0; i < nodes.length && out.length < limit; i += 1) {
    const el = nodes[i];
    if (isElementSkipped(el)) continue;
    const nid = el.getAttribute(NID_ATTR);
    if (!nid) continue;
    let parentNid = '';
    let p = el.parentElement;
    while (p) {
      const pn = typeof p.getAttribute === 'function' ? p.getAttribute(NID_ATTR) : null;
      if (pn) {
        const Scope = globalThis.PageAdvisorScope;
        const captureRoot = root.nodeType === 1 ? root : null;
        parentNid = Scope && typeof Scope.parentNidIfInside === 'function'
          ? Scope.parentNidIfInside(captureRoot, p, pn)
          : String(pn);
        break;
      }
      p = p.parentElement;
    }
    let text = '';
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      text = String(el.getAttribute?.('placeholder') || el.value || '').trim();
    } else if (el.tagName === 'IMG') {
      text = String(el.getAttribute?.('alt') || '').trim();
    } else {
      text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    }
    if (Array.from(text).length > 80) {
      text = Array.from(text).slice(0, 80).join('');
    }
    const anchor = typeof globalThis.pageAdvisorDomAnchor === 'function'
      ? globalThis.pageAdvisorDomAnchor(el)
      : {};
    out.push({
      nid: String(nid),
      tag: String(el.tagName || '').toLowerCase(),
      role: String(el.getAttribute?.('role') || ''),
      text,
      parent_nid: parentNid,
      id: clipOutlineField(anchor.id, MAX_OUTLINE_LABEL_CHARS),
      testid: clipOutlineField(anchor.testid, MAX_OUTLINE_LABEL_CHARS),
      aria_label: clipOutlineField(anchor.aria_label, MAX_OUTLINE_ARIA_CHARS),
      landmark: clipOutlineField(anchor.landmark, MAX_OUTLINE_ARIA_CHARS),
      css_path: clipOutlineField(anchor.css_path, MAX_OUTLINE_LABEL_CHARS),
      label: clipOutlineField(anchor.label, MAX_OUTLINE_LABEL_CHARS),
      visible_text: clipOutlineField(anchor.visible_text || text, MAX_OUTLINE_LABEL_CHARS),
      html_snippet: clipOutlineField(anchor.html_snippet, MAX_OUTLINE_HTML_SNIPPET_CHARS),
    });
  }
  return out;
}

/** 移除会话 nid 属性（关闭 Alt+Z 时调用）。 */
function clearDomNids(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll(`[${NID_ATTR}]`).forEach((el) => {
    try {
      el.removeAttribute(NID_ATTR);
    } catch (_) { /* ignore */ }
  });
}

function capturePageContextInRect(opts = {}) {
  const api = globalThis.PageContextRect;
  if (!api || typeof api.capture !== 'function') return capturePageContext(opts);
  return api.capture(opts, {
    capturePageContext,
    isElementSkipped,
    stampDomNids,
    extractVisibleReadableText,
    truncatePageText,
    captureDomOutline,
    maxNodes: MAX_DOM_OUTLINE_NODES,
  });
}

function capturePageContextForElements(opts = {}) {
  const api = globalThis.PageContextElements;
  if (!api || typeof api.capture !== 'function') return capturePageContext(opts);
  return api.capture(opts, {
    capturePageContext,
    isPluginChromeUi,
    stampDomNids,
    extractVisibleReadableText,
    truncatePageText,
    captureDomOutline,
    maxNodes: MAX_DOM_OUTLINE_NODES,
  });
}

const PageContext = {
  MAX_PAGE_TEXT_RUNES,
  MAX_DOM_OUTLINE_NODES,
  MAX_OUTLINE_LABEL_CHARS,
  MAX_OUTLINE_ARIA_CHARS,
  MAX_OUTLINE_HTML_SNIPPET_CHARS,
  NID_ATTR,
  SKIP_TAGS,
  truncatePageText,
  isPluginChromeUi,
  isElementSkipped,
  extractVisibleReadableText,
  capturePageContext,
  capturePageContextInRect,
  capturePageContextForElements,
  stampDomNids,
  captureDomOutline,
  clearDomNids,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageContext;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageContext = PageContext;
}
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    MAX_PAGE_TEXT_RUNES, MAX_DOM_OUTLINE_NODES, NID_ATTR, SKIP_TAGS,
    MAX_OUTLINE_LABEL_CHARS, MAX_OUTLINE_ARIA_CHARS, MAX_OUTLINE_HTML_SNIPPET_CHARS,
    OUTLINE_TAGS, truncatePageText, isPluginChromeUi, isElementSkipped,
    extractVisibleReadableText, capturePageContext, stampDomNids,
    captureDomOutline, clearDomNids, capturePageContextInRect,
    capturePageContextForElements,
  });
}
}
