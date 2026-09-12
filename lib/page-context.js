/**
 * 页面上下文采集（纯函数优先）— Alt+E 页面优化建议。
 * 提取可见可读文本（跳过 script/style/隐藏节点），并做长度截断。
 */

'use strict';

/** 与 taskPageAdvisor domain.MaxPageTextRunes 对齐（32KiB 字符） */
const MAX_PAGE_TEXT_RUNES = 32 * 1024;

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME',
  'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED',
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
 * 元素是否应跳过（标签 / hidden / aria-hidden / 显式 display|visibility）。
 * @param {Element} el
 * @returns {boolean}
 */
function isElementSkipped(el) {
  if (!el || el.nodeType !== 1) return true;
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
 * @param {{ url?: string, title?: string, root?: Node, maxRunes?: number }} [opts]
 * @returns {{ url: string, title: string, pageText: string, pageTextTruncated: boolean }}
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

  const raw = extractVisibleReadableText(root);
  const { text, truncated } = truncatePageText(raw, opts.maxRunes);
  return {
    url: String(url || ''),
    title: String(title || ''),
    pageText: text,
    pageTextTruncated: truncated,
  };
}

const PageContext = {
  MAX_PAGE_TEXT_RUNES,
  SKIP_TAGS,
  truncatePageText,
  isElementSkipped,
  extractVisibleReadableText,
  capturePageContext,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageContext;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageContext = PageContext;
}
