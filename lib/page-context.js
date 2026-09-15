/**
 * 页面上下文采集（纯函数优先）— Alt+E 页面优化建议。
 * 提取可见可读文本（跳过 script/style/隐藏节点），并做长度截断。
 */

'use strict';

/** 与 taskPageAdvisor domain.MaxPageTextRunes 对齐（32KiB 字符） */
const MAX_PAGE_TEXT_RUNES = 32 * 1024;
/** 与 taskPageAdvisor domain.MaxDomOutlineNodes 对齐 */
const MAX_DOM_OUTLINE_NODES = 200;
const NID_ATTR = 'data-taskplugin-nid';

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
 * 避免 Alt+E / Alt+Shift+E 把悬浮面板文案当成宿主页内容去「优化」。
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
  const walker = typeof document !== 'undefined' && document.createTreeWalker
    ? null
    : null;
  void walker;
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
      if (!el.getAttribute || !el.getAttribute(NID_ATTR)) {
        if (typeof el.setAttribute === 'function') {
          el.setAttribute(NID_ATTR, `n${n + 1}`);
        }
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
        parentNid = pn;
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
    out.push({
      nid: String(nid),
      tag: String(el.tagName || '').toLowerCase(),
      role: String(el.getAttribute?.('role') || ''),
      text,
      parent_nid: parentNid,
    });
  }
  return out;
}

/** 移除会话 nid 属性（关闭 Alt+E 时调用）。 */
function clearDomNids(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll(`[${NID_ATTR}]`).forEach((el) => {
    try {
      el.removeAttribute(NID_ATTR);
    } catch (_) { /* ignore */ }
  });
}

/**
 * 采集与 viewport 矩形相交的子树上下文（Alt+Shift+E）。
 * @param {{
 *   region: { left:number, top:number, width:number, height:number },
 *   url?: string, title?: string, root?: Element|Document,
 *   maxRunes?: number, maxOutlineNodes?: number, stampNids?: boolean,
 *   getBoundingClientRect?: (el: Element) => { left:number, top:number, width:number, height:number }
 * }} opts
 */
function capturePageContextInRect(opts = {}) {
  const region = opts.region;
  if (!region || !(Number(region.width) > 0) || !(Number(region.height) > 0)) {
    return capturePageContext(opts);
  }

  function intersects(a, b) {
    if (!a || !b) return false;
    return a.left < b.left + b.width
      && a.left + a.width > b.left
      && a.top < b.top + b.height
      && a.top + a.height > b.top;
  }

  const getRect = typeof opts.getBoundingClientRect === 'function'
    ? opts.getBoundingClientRect
    : (el) => {
      if (el && typeof el.getBoundingClientRect === 'function') {
        try {
          const r = el.getBoundingClientRect();
          return {
            left: Number(r.left) || 0,
            top: Number(r.top) || 0,
            width: Number(r.width) || 0,
            height: Number(r.height) || 0,
          };
        } catch (_) { /* jsdom */ }
      }
      return { left: 0, top: 0, width: 0, height: 0 };
    };

  let url = opts.url;
  let title = opts.title;
  let root = opts.root;
  if (url == null && typeof location !== 'undefined') url = location.href;
  if (title == null && typeof document !== 'undefined') title = document.title;
  if (root == null && typeof document !== 'undefined') {
    root = document.body || document.documentElement;
  }
  if (!root) {
    return {
      url: String(url || ''),
      title: String(title || ''),
      pageText: '',
      pageTextTruncated: false,
      domOutline: [],
      regionScoped: true,
    };
  }

  const scope = root.nodeType === 9 ? root.body || root.documentElement : root;
  const hits = [];
  const stack = scope ? [scope] : [];
  while (stack.length) {
    const el = stack.pop();
    if (!el || el.nodeType !== 1) continue;
    if (isElementSkipped(el)) continue;
    const rect = getRect(el);
    if (intersects(region, rect)) hits.push(el);
    const children = el.children || el.childNodes || [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]);
    }
  }

  const hitSet = new Set(hits);
  // Prefer leaf hits：祖先容器与区域相交时，避免整棵子树把区域外文案一并采入。
  const leafHits = hits.filter((el) => {
    for (const other of hits) {
      if (other === el) continue;
      let p = other.parentElement;
      while (p) {
        if (p === el) return false;
        p = p.parentElement;
      }
    }
    return true;
  });
  void hitSet;

  const stamp = opts.stampNids !== false;
  if (stamp) {
    for (const el of leafHits) {
      stampDomNids(el);
    }
  }

  const raw = leafHits
    .map((el) => extractVisibleReadableText(el))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const { text, truncated } = truncatePageText(raw, opts.maxRunes);

  let domOutline = [];
  for (const el of leafHits) {
    const part = captureDomOutline(el, opts.maxOutlineNodes);
    domOutline = domOutline.concat(part);
    if (domOutline.length >= (opts.maxOutlineNodes || MAX_DOM_OUTLINE_NODES)) {
      domOutline = domOutline.slice(0, opts.maxOutlineNodes || MAX_DOM_OUTLINE_NODES);
      break;
    }
  }

  return {
    url: String(url || ''),
    title: String(title || ''),
    pageText: text,
    pageTextTruncated: truncated,
    domOutline,
    regionScoped: true,
  };
}

/**
 * 采集指定元素子树上下文（Alt+Shift+E 元素点选）。
 * @param {{
 *   roots: Element[],
 *   url?: string, title?: string,
 *   maxRunes?: number, maxOutlineNodes?: number, stampNids?: boolean,
 * }} opts
 */
function capturePageContextForElements(opts = {}) {
  const roots = Array.isArray(opts.roots)
    ? opts.roots.filter((el) => el && el.nodeType === 1 && !isPluginChromeUi(el))
    : [];
  if (!roots.length) {
    return capturePageContext(opts);
  }

  let url = opts.url;
  let title = opts.title;
  if (url == null && typeof location !== 'undefined') url = location.href;
  if (title == null && typeof document !== 'undefined') title = document.title;

  const stamp = opts.stampNids !== false;
  if (stamp) {
    for (const el of roots) {
      stampDomNids(el);
    }
  }

  const raw = roots
    .map((el) => extractVisibleReadableText(el))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const { text, truncated } = truncatePageText(raw, opts.maxRunes);

  let domOutline = [];
  const limit = opts.maxOutlineNodes || MAX_DOM_OUTLINE_NODES;
  for (const el of roots) {
    const part = captureDomOutline(el, limit);
    domOutline = domOutline.concat(part);
    if (domOutline.length >= limit) {
      domOutline = domOutline.slice(0, limit);
      break;
    }
  }

  return {
    url: String(url || ''),
    title: String(title || ''),
    pageText: text,
    pageTextTruncated: truncated,
    domOutline,
    regionScoped: true,
  };
}

const PageContext = {
  MAX_PAGE_TEXT_RUNES,
  MAX_DOM_OUTLINE_NODES,
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
