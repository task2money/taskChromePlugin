/**
 * 页面元素选择 — 纯函数（Shadow open/closed、iframe、截图 URL / 描述拼接）
 * 无 Chrome API 硬依赖（closed Shadow opener 可注入）；content / frame / node --test 共用
 */

const MAX_TEXT = 120;
const MAX_OUTER = 240;
const MAX_SCREENSHOT_CHARS = 400000;
const SCREENSHOT_MAX_WIDTH = 400;

function truncateText(str, max = MAX_TEXT) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function buildElementLabel(parts) {
  const tag = String(parts?.tagName || 'unknown').toLowerCase();
  const id = parts?.id ? `#${CSS_escapeId(parts.id)}` : '';
  const classes = normalizeClassList(parts?.className)
    .map((c) => `.${CSS_escapeClass(c)}`)
    .join('');
  return `${tag}${id}${classes}`;
}

function CSS_escapeId(id) {
  return String(id).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function CSS_escapeClass(c) {
  return String(c).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function normalizeClassList(className) {
  if (Array.isArray(className)) {
    return className.map((c) => String(c).trim()).filter(Boolean);
  }
  return String(className || '')
    .split(/\s+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function buildCssPath(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return '';
  const parts = [];
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i];
    const tag = String(node.tagName || '*').toLowerCase();
    let seg;
    if (node.id) {
      seg = `${tag}#${CSS_escapeId(node.id)}`;
    } else {
      const classes = normalizeClassList(node.className)
        .slice(0, 2)
        .map((c) => `.${CSS_escapeClass(c)}`)
        .join('');
      const nth = node.nthOfType != null && node.nthOfType > 1
        ? `:nth-of-type(${node.nthOfType})`
        : '';
      seg = `${tag}${classes}${nth}`;
    }
    if (i === 0) parts.push(seg);
    else if (node.crossedShadowFromParent) parts.push('>>>', seg);
    else parts.push('>', seg);
  }
  return parts.join(' ');
}

function getParentCrossingShadow(el) {
  if (!el || el.nodeType !== 1) return { parent: null, crossedShadow: false };
  if (el.parentElement) return { parent: el.parentElement, crossedShadow: false };
  const root = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
  if (root && root.host && root.host.nodeType === 1) {
    return { parent: root.host, crossedShadow: true };
  }
  return { parent: null, crossedShadow: false };
}

function getOpenOrClosedShadowRoot(el, opener) {
  if (!el || el.nodeType !== 1) return null;
  if (typeof opener === 'function') {
    try {
      return opener(el) || null;
    } catch (_) {
      return null;
    }
  }
  if (typeof chrome !== 'undefined' && chrome.dom && typeof chrome.dom.openOrClosedShadowRoot === 'function') {
    try {
      return chrome.dom.openOrClosedShadowRoot(el) || null;
    } catch (_) { /* ignore */ }
  }
  return el.shadowRoot || null;
}

function hitTestInRoot(root, clientX, clientY) {
  if (!root || typeof root.querySelectorAll !== 'function') return null;
  const nodes = root.querySelectorAll('*');
  let best = null;
  let bestArea = Infinity;
  for (const el of nodes) {
    if (!el.getBoundingClientRect) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
    const area = r.width * r.height;
    if (area < bestArea) {
      bestArea = area;
      best = el;
    }
  }
  return best;
}

/**
 * 视口坐标深入 open/closed Shadow（不含跨 iframe）
 */
function deepElementFromPoint(doc, clientX, clientY, options = {}) {
  if (!doc || typeof doc.elementFromPoint !== 'function') {
    return { el: null, closedShadow: false };
  }
  let el = doc.elementFromPoint(clientX, clientY);
  if (!el || el.nodeType !== 1) return { el: null, closedShadow: false };
  if (typeof options.isExcluded === 'function' && options.isExcluded(el)) {
    return { el: null, closedShadow: false };
  }

  let closedShadow = false;
  const maxDepth = options.maxDepth || 24;
  for (let i = 0; i < maxDepth; i++) {
    const sr = getOpenOrClosedShadowRoot(el, options.openShadowRoot);
    if (!sr) break;
    if (sr.mode === 'closed') closedShadow = true;
    const inner = hitTestInRoot(sr, clientX, clientY);
    if (!inner || inner === el) break;
    if (typeof options.isExcluded === 'function' && options.isExcluded(inner)) break;
    el = inner;
  }
  return { el, closedShadow };
}

function buildAncestorChain(el, isExcluded) {
  const chain = [];
  let cur = el;
  let crossedIntoCurrent = false;
  while (cur && cur.nodeType === 1) {
    if (typeof isExcluded === 'function' && isExcluded(cur)) break;
    if (typeof document !== 'undefined' && cur === document.documentElement) {
      chain.unshift({
        tagName: 'html',
        id: cur.id || '',
        className: typeof cur.className === 'string' ? cur.className : '',
        nthOfType: 1,
        crossedShadowFromParent: crossedIntoCurrent,
      });
      break;
    }
    const tag = cur.tagName;
    let nth = 1;
    let sib = cur.previousElementSibling;
    while (sib) {
      if (sib.tagName === tag) nth += 1;
      sib = sib.previousElementSibling;
    }
    chain.unshift({
      tagName: tag,
      id: cur.id || '',
      className: typeof cur.className === 'string' ? cur.className : (cur.getAttribute?.('class') || ''),
      nthOfType: nth,
      crossedShadowFromParent: crossedIntoCurrent,
    });
    if (cur.id && !crossedIntoCurrent) break;

    const { parent, crossedShadow } = getParentCrossingShadow(cur);
    crossedIntoCurrent = crossedShadow;
    cur = parent;
  }
  return chain;
}

function resolveComposedElement(event, isExcluded) {
  const path = typeof event?.composedPath === 'function' ? event.composedPath() : [event?.target];
  for (const n of path) {
    if (!n || n.nodeType !== 1) continue;
    if (typeof isExcluded === 'function' && isExcluded(n)) continue;
    return n;
  }
  return null;
}

function pierceSameOriginIframe(iframe, clientX, clientY, options = {}) {
  if (!iframe || String(iframe.tagName || '').toUpperCase() !== 'IFRAME') {
    throw new Error('pierceSameOriginIframe: 需要 iframe 元素');
  }
  let doc;
  try {
    doc = iframe.contentDocument;
  } catch (_) {
    const err = new Error('跨域 iframe 无法选择内部元素');
    err.code = 'CROSS_ORIGIN_IFRAME';
    throw err;
  }
  if (!doc) {
    const err = new Error('跨域 iframe 无法选择内部元素');
    err.code = 'CROSS_ORIGIN_IFRAME';
    throw err;
  }
  const rect = iframe.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const deep = deepElementFromPoint(doc, x, y, {
    openShadowRoot: options.openShadowRoot,
  });
  const inner = deep.el || doc.elementFromPoint(x, y);
  if (!inner || inner.nodeType !== 1) {
    throw new Error('iframe 内未命中元素');
  }
  return { el: inner, closedShadow: !!deep.closedShadow };
}

/**
 * Chromium UA Shadow 宿主：扩展无法 openOrClosedShadowRoot 进入内部。
 * 仅做识别与标注，不伪造内部穿透。
 */
function isLikelyUaShadowHost(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'video' || tag === 'audio' || tag === 'select' || tag === 'meter'
    || tag === 'progress' || tag === 'embed' || tag === 'object') {
    return true;
  }
  if (tag === 'input') {
    const t = String(el.getAttribute?.('type') || 'text').toLowerCase();
    return [
      'range', 'color', 'date', 'time', 'datetime-local', 'month', 'week',
      'file', 'checkbox', 'radio',
    ].includes(t);
  }
  return false;
}

/**
 * 若宿主像 UA Shadow 且 opener 打不开 shadow，则标记不可穿透。
 */
function detectUaShadowOpaque(el, options = {}) {
  if (!isLikelyUaShadowHost(el)) {
    return { uaShadowHost: false, uaShadowOpaque: false };
  }
  const sr = getOpenOrClosedShadowRoot(el, options.openShadowRoot);
  if (sr) {
    return { uaShadowHost: true, uaShadowOpaque: false };
  }
  return { uaShadowHost: true, uaShadowOpaque: true };
}

function normalizeFrameUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw, 'https://taskplugin.invalid');
    u.hash = '';
    let path = u.pathname || '/';
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    if (u.protocol === 'about:') return u.href;
    return `${u.protocol}//${u.host}${path}${u.search}`;
  } catch (_) {
    return raw;
  }
}

function urlsLikelySameFrame(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const na = normalizeFrameUrl(a);
  const nb = normalizeFrameUrl(b);
  if (na && nb && na === nb) return true;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.origin !== ub.origin) return false;
    const pa = (ua.pathname || '/').replace(/\/$/, '') || '/';
    const pb = (ub.pathname || '/').replace(/\/$/, '') || '/';
    return pa === pb && ua.search === ub.search;
  } catch (_) {
    return false;
  }
}

/**
 * 在文档中按 URL 对齐查找 iframe（src 或同源 contentWindow.location）
 */
function findIframeElementByUrl(rootDoc, frameUrl) {
  if (!rootDoc || !frameUrl || typeof rootDoc.querySelectorAll !== 'function') return null;
  const iframes = Array.from(rootDoc.querySelectorAll('iframe'));
  let match = iframes.find((f) => f.src && urlsLikelySameFrame(f.src, frameUrl));
  if (match) return match;
  for (const f of iframes) {
    try {
      const href = f.contentWindow?.location?.href;
      if (href && urlsLikelySameFrame(href, frameUrl)) return f;
    } catch (_) { /* cross-origin */ }
  }
  return null;
}

/**
 * 从 getAllFrames 结果构建「顶层之下 → leaf」路径（不含 frameId 0）
 */
function buildFramePathFromRoot(frames, leafFrameId) {
  const list = Array.isArray(frames) ? frames : [];
  const byId = new Map();
  for (const f of list) {
    if (f && f.frameId != null) byId.set(f.frameId, f);
  }
  const chain = [];
  let cur = byId.get(leafFrameId);
  const guard = new Set();
  while (cur && cur.frameId !== 0 && !guard.has(cur.frameId)) {
    guard.add(cur.frameId);
    chain.push({
      frameId: cur.frameId,
      parentFrameId: cur.parentFrameId,
      url: cur.url || '',
    });
    cur = byId.get(cur.parentFrameId);
  }
  chain.reverse();
  return chain;
}

/**
 * 将 leaf 内矩形与各层父 iframe 矩形累加成顶层视口坐标
 * @param {{left:number,top:number,width:number,height:number}} leafRect
 * @param {Array<{left:number,top:number}>} ancestorIframeRects 与 framePath 同序（近顶 → 近 leaf）
 */
function accumulateFrameViewportRect(leafRect, ancestorIframeRects) {
  let left = Number(leafRect?.left) || 0;
  let top = Number(leafRect?.top) || 0;
  for (const r of ancestorIframeRects || []) {
    left += Number(r?.left) || 0;
    top += Number(r?.top) || 0;
  }
  return {
    left,
    top,
    width: Number(leafRect?.width) || 0,
    height: Number(leafRect?.height) || 0,
  };
}

/**
 * 在父节点 element children 中的 1-based 下标
 */
function getChildElementIndex(el) {
  if (!el || el.nodeType !== 1 || !el.parentElement) return 1;
  let nth = 1;
  let sib = el.parentElement.firstElementChild;
  while (sib) {
    if (sib === el) return nth;
    nth += 1;
    sib = sib.nextElementSibling;
  }
  return 1;
}

/**
 * 同 tag 的 :nth-of-type 序号（1-based）
 */
function getNthOfType(el) {
  if (!el || el.nodeType !== 1) return 1;
  const tag = el.tagName;
  let nth = 1;
  let sib = el.previousElementSibling;
  while (sib) {
    if (sib.tagName === tag) nth += 1;
    sib = sib.previousElementSibling;
  }
  return nth;
}

/**
 * 收集同父下两端点之间的连续兄弟（含端点，文档序）
 * @returns {Element[]|null}
 */
function collectContiguousSiblings(a, b) {
  if (!a || !b || a.nodeType !== 1 || b.nodeType !== 1) return null;
  if (!a.parentElement || a.parentElement !== b.parentElement) return null;
  const kids = Array.from(a.parentElement.children || []);
  const i = kids.indexOf(a);
  const j = kids.indexOf(b);
  if (i < 0 || j < 0) return null;
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);
  return kids.slice(lo, hi + 1);
}

/**
 * 为连续兄弟区间生成相对父节点的 CSS 路径
 */
function buildSiblingRangeCssPath(elements, options = {}) {
  if (!Array.isArray(elements) || elements.length === 0) return '';
  if (elements.length === 1) {
    return snapshotElement(elements[0], options).cssPath;
  }
  const first = elements[0];
  const last = elements[elements.length - 1];
  const parent = first.parentElement;
  if (!parent || parent !== last.parentElement) {
    throw new Error('buildSiblingRangeCssPath: 需要同父连续兄弟');
  }

  const isExcluded = (n) => !!(
    n.id === 'taskplugin-float-root'
    || (n.closest && n.closest('#taskplugin-float-root'))
  );
  const parentChain = buildAncestorChain(parent, isExcluded);
  const parentPath = buildCssPath(parentChain);

  const allSameTag = elements.every((el) => el.tagName === first.tagName);
  let rangeSeg;
  if (allSameTag) {
    const tag = String(first.tagName || '*').toLowerCase();
    const classes = normalizeClassList(
      typeof first.className === 'string'
        ? first.className
        : first.getAttribute?.('class') || '',
    )
      .slice(0, 2)
      .map((c) => `.${CSS_escapeClass(c)}`)
      .join('');
    const startNth = getNthOfType(first);
    const endNth = getNthOfType(last);
    rangeSeg = `${tag}${classes}:nth-of-type(n+${startNth}):nth-of-type(-n+${endNth})`;
  } else {
    const startIdx = getChildElementIndex(first);
    const endIdx = getChildElementIndex(last);
    rangeSeg = `:nth-child(n+${startIdx}):nth-child(-n+${endIdx})`;
  }

  let cssPath = parentPath ? `${parentPath} > ${rangeSeg}` : rangeSeg;

  const frameElement = options.frameElement || null;
  if (frameElement && frameElement.nodeType === 1) {
    const frameChain = buildAncestorChain(frameElement, isExcluded);
    const framePath = buildCssPath(frameChain) || buildElementLabel({
      tagName: frameElement.tagName,
      id: frameElement.id,
      className: typeof frameElement.className === 'string' ? frameElement.className : '',
    });
    cssPath = `${framePath} >>> ${cssPath}`;
  } else if (options.framePathPrefix) {
    cssPath = `${options.framePathPrefix} >>> ${cssPath}`;
  }
  return cssPath;
}

function buildSiblingRangeLabel(elements, snaps) {
  const n = elements.length;
  if (n === 1) return snaps[0]?.label || 'unknown';
  const first = elements[0];
  const allSameTag = elements.every((el) => el.tagName === first.tagName);
  if (allSameTag) {
    const base = snaps[0]?.label || buildElementLabel({
      tagName: first.tagName,
      id: first.id,
      className: typeof first.className === 'string' ? first.className : '',
    });
    return `${base} ×${n}`;
  }
  return `混合兄弟 ×${n}`;
}

/**
 * 视口矩形并集（client rect 风格）
 */
function unionClientRects(rects) {
  const list = (Array.isArray(rects) ? rects : []).filter(
    (r) => r && Number(r.width) > 0 && Number(r.height) > 0,
  );
  if (list.length === 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of list) {
    const l = Number(r.left) || 0;
    const t = Number(r.top) || 0;
    const w = Number(r.width) || 0;
    const h = Number(r.height) || 0;
    left = Math.min(left, l);
    top = Math.min(top, t);
    right = Math.max(right, l + w);
    bottom = Math.max(bottom, t + h);
  }
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * 连续兄弟区间快照；单元素时退化为 snapshotElement
 */
function snapshotSiblingRange(elements, options = {}) {
  if (!Array.isArray(elements) || elements.length === 0) {
    throw new Error('snapshotSiblingRange: 需要至少一个 Element');
  }
  if (elements.length === 1) {
    return snapshotElement(elements[0], options);
  }
  const ordered = collectContiguousSiblings(elements[0], elements[elements.length - 1]);
  if (!ordered || ordered.length !== elements.length) {
    // 允许调用方已传入有序切片
    const parent = elements[0].parentElement;
    if (!parent || !elements.every((el) => el.parentElement === parent)) {
      throw new Error('snapshotSiblingRange: 元素必须是同父连续兄弟');
    }
  }
  const rangeEls = ordered && ordered.length === elements.length ? ordered : elements;
  const snaps = rangeEls.map((el) => snapshotElement(el, options));
  const first = rangeEls[0];
  const last = rangeEls[rangeEls.length - 1];
  const startChild = getChildElementIndex(first);
  const endChild = getChildElementIndex(last);
  const allSameTag = rangeEls.every((el) => el.tagName === first.tagName);
  const cssPath = buildSiblingRangeCssPath(rangeEls, options);

  return {
    multi: true,
    siblingCount: rangeEls.length,
    tagName: allSameTag ? String(first.tagName || '').toLowerCase() : '*',
    id: '',
    className: '',
    label: buildSiblingRangeLabel(rangeEls, snaps),
    cssPath,
    visibleText: truncateText(
      snaps.map((s) => s.visibleText).filter(Boolean).join(' | '),
    ),
    outerHtmlSnippet: truncateText(
      snaps.map((s) => s.outerHtmlSnippet).filter(Boolean).join(' … '),
      MAX_OUTER,
    ),
    isSensitive: snaps.some((s) => s.isSensitive),
    inShadow: snaps.some((s) => s.inShadow),
    inClosedShadow: snaps.some((s) => s.inClosedShadow) || !!options.closedShadow,
    inIframe: snaps.some((s) => s.inIframe) || !!(options.frameElement || options.inIframe),
    crossOriginIframe: snaps.some((s) => s.crossOriginIframe) || !!options.crossOriginIframe,
    uaShadowHost: snaps.some((s) => s.uaShadowHost),
    uaShadowOpaque: snaps.some((s) => s.uaShadowOpaque),
    siblingRange: {
      startChildIndex: Math.min(startChild, endChild),
      endChildIndex: Math.max(startChild, endChild),
      count: rangeEls.length,
      sameTag: allSameTag,
    },
    siblings: snaps.map((s) => ({
      label: s.label,
      cssPath: s.cssPath,
      visibleText: s.visibleText,
    })),
  };
}

function snapshotElement(el, options = {}) {
  if (!el || el.nodeType !== 1) {
    throw new Error('snapshotElement: 需要 Element 节点');
  }
  const tagName = el.tagName.toLowerCase();
  const typeAttr = (el.getAttribute && el.getAttribute('type')) || '';
  const isSensitive =
    tagName === 'input' &&
    (String(typeAttr).toLowerCase() === 'password' ||
      /password|passwd|pwd/i.test(el.getAttribute?.('name') || '') ||
      /password|passwd|pwd/i.test(el.id || ''));

  let visibleText = '';
  if (isSensitive) {
    visibleText = '[敏感输入已省略]';
  } else if (tagName === 'input' || tagName === 'textarea') {
    visibleText = truncateText(el.getAttribute('placeholder') || el.value || '');
  } else {
    visibleText = truncateText(el.textContent || '');
  }

  const className =
    typeof el.className === 'string'
      ? el.className
      : el.getAttribute?.('class') || '';

  const chain = buildAncestorChain(el, (n) => {
    return !!(n.id === 'taskplugin-float-root' || (n.closest && n.closest('#taskplugin-float-root')));
  });

  let outerHtmlSnippet = '';
  if (!isSensitive && typeof el.outerHTML === 'string') {
    outerHtmlSnippet = truncateText(el.outerHTML, MAX_OUTER);
  }

  const inShadow = chain.some((n) => n.crossedShadowFromParent) || !!options.closedShadow;
  const frameElement = options.frameElement || null;
  let cssPath = buildCssPath(chain);
  if (frameElement && frameElement.nodeType === 1) {
    const frameChain = buildAncestorChain(frameElement, (n) => {
      return !!(n.id === 'taskplugin-float-root' || (n.closest && n.closest('#taskplugin-float-root')));
    });
    const framePath = buildCssPath(frameChain) || buildElementLabel({
      tagName: frameElement.tagName,
      id: frameElement.id,
      className: typeof frameElement.className === 'string' ? frameElement.className : '',
    });
    cssPath = `${framePath} >>> ${cssPath}`;
  } else if (options.framePathPrefix) {
    cssPath = `${options.framePathPrefix} >>> ${cssPath}`;
  }

  const ua = detectUaShadowOpaque(el, options);

  return {
    tagName,
    id: el.id || '',
    className,
    label: buildElementLabel({ tagName, id: el.id, className }),
    cssPath,
    visibleText,
    outerHtmlSnippet,
    isSensitive,
    inShadow,
    inClosedShadow: !!options.closedShadow,
    inIframe: !!(frameElement || options.inIframe),
    crossOriginIframe: !!options.crossOriginIframe,
    uaShadowHost: !!ua.uaShadowHost,
    uaShadowOpaque: !!ua.uaShadowOpaque,
  };
}

function validateAdjustment(adjustment) {
  const t = String(adjustment || '').trim();
  if (!t) return '请填写希望对该元素做什么调整';
  if (t.length > 2000) return '调整期望过长（最多 2000 字）';
  return null;
}

function validateScreenshotDataUrl(dataUrl) {
  if (dataUrl == null || dataUrl === '') return null;
  const s = String(dataUrl);
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(s)) {
    return '截图格式无效（需要 data:image/*;base64）';
  }
  if (s.length > MAX_SCREENSHOT_CHARS) {
    return `截图过大（>${MAX_SCREENSHOT_CHARS} 字符），请取消勾选后重试`;
  }
  return null;
}

/**
 * 校验已上传的截图 URL（禁止再内嵌超大 data URL）
 */
function validateScreenshotUrl(url) {
  if (url == null || url === '') return null;
  const s = String(url).trim();
  if (/^data:/i.test(s)) {
    return '截图应使用已上传的 http(s) URL，请勿内嵌 data URL';
  }
  if (!/^https?:\/\//i.test(s)) {
    return '截图 URL 无效（需要 http/https）';
  }
  if (s.length > 2000) return '截图 URL 过长';
  return null;
}

function formatElementAdjustmentBlock(payload) {
  const pageUrl = String(payload?.pageUrl || '').trim();
  if (!pageUrl) throw new Error('formatElementAdjustmentBlock: pageUrl 必填');
  const adjErr = validateAdjustment(payload?.adjustment);
  if (adjErr) throw new Error(adjErr);
  const el = payload.element;
  if (!el?.label) throw new Error('formatElementAdjustmentBlock: element.label 必填');

  const screenshotUrl = payload.screenshotUrl ? String(payload.screenshotUrl).trim() : '';
  const screenshotDataUrl = payload.screenshotDataUrl ? String(payload.screenshotDataUrl) : '';
  if (screenshotUrl) {
    const uErr = validateScreenshotUrl(screenshotUrl);
    if (uErr) throw new Error(uErr);
  } else if (screenshotDataUrl) {
    const dErr = validateScreenshotDataUrl(screenshotDataUrl);
    if (dErr) throw new Error(dErr);
  }

  const lines = [
    '---',
    '**页面元素调整**',
    `- **页面链接**: ${pageUrl}`,
  ];
  if (payload.pageTitle) {
    lines.push(`- **页面标题**: ${String(payload.pageTitle)}`);
  }
  lines.push(`- **元素**: \`${el.label}\``);
  if (el.cssPath) lines.push(`- **选择器**: \`${el.cssPath}\``);
  if (el.multi && el.siblingRange) {
    const sr = el.siblingRange;
    const start = sr.startChildIndex != null ? sr.startChildIndex : '?';
    const end = sr.endChildIndex != null ? sr.endChildIndex : '?';
    const count = sr.count != null ? sr.count : el.siblingCount;
    lines.push(`- **兄弟区间**: 第 ${start}–${end} 项（共 ${count} 个）`);
  }
  if (el.inClosedShadow) lines.push('- **上下文**: closed Shadow DOM');
  else if (el.inShadow) lines.push('- **上下文**: Shadow DOM');
  if (el.uaShadowOpaque) {
    lines.push('- **上下文**: 原生控件 UA Shadow（内部不可穿透，已选中宿主元素）');
  } else if (el.uaShadowHost) {
    lines.push('- **上下文**: 原生控件宿主');
  }
  if (el.crossOriginIframe) lines.push('- **上下文**: 跨域 iframe');
  else if (el.inIframe) lines.push('- **上下文**: 同源 iframe');
  if (el.visibleText) lines.push(`- **可见文本**: "${el.visibleText}"`);
  if (el.frameNestingDepth > 1) {
    lines.push(`- **iframe 嵌套深度**: ${el.frameNestingDepth}`);
  }
  if (el.outerHtmlSnippet) {
    lines.push(`- **HTML 片段**: \`${el.outerHtmlSnippet}\``);
  }
  lines.push(`- **调整期望**: ${String(payload.adjustment).trim()}`);
  if (screenshotUrl) {
    lines.push('- **元素截图**:');
    lines.push(`![element](${screenshotUrl})`);
  } else if (screenshotDataUrl) {
    lines.push('- **元素截图**:');
    lines.push(`![element](${screenshotDataUrl})`);
  }
  return lines.join('\n');
}

function appendElementAdjustmentToDescription(existingDesc, payload) {
  const block = formatElementAdjustmentBlock(payload);
  const base = String(existingDesc || '').trimEnd();
  if (!base) return block;
  return `${base}\n\n${block}`;
}

const ElementPicker = {
  truncateText,
  buildElementLabel,
  buildCssPath,
  getParentCrossingShadow,
  getOpenOrClosedShadowRoot,
  hitTestInRoot,
  deepElementFromPoint,
  buildAncestorChain,
  resolveComposedElement,
  pierceSameOriginIframe,
  isLikelyUaShadowHost,
  detectUaShadowOpaque,
  normalizeFrameUrl,
  urlsLikelySameFrame,
  findIframeElementByUrl,
  buildFramePathFromRoot,
  accumulateFrameViewportRect,
  getChildElementIndex,
  getNthOfType,
  collectContiguousSiblings,
  buildSiblingRangeCssPath,
  buildSiblingRangeLabel,
  unionClientRects,
  snapshotSiblingRange,
  snapshotElement,
  validateAdjustment,
  validateScreenshotDataUrl,
  validateScreenshotUrl,
  formatElementAdjustmentBlock,
  appendElementAdjustmentToDescription,
  MAX_TEXT,
  MAX_OUTER,
  MAX_SCREENSHOT_CHARS,
  SCREENSHOT_MAX_WIDTH,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ElementPicker;
}
if (typeof globalThis !== 'undefined') {
  globalThis.ElementPicker = ElementPicker;
}
