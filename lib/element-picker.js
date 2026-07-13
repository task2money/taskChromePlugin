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
  if (el.inClosedShadow) lines.push('- **上下文**: closed Shadow DOM');
  else if (el.inShadow) lines.push('- **上下文**: Shadow DOM');
  if (el.crossOriginIframe) lines.push('- **上下文**: 跨域 iframe');
  else if (el.inIframe) lines.push('- **上下文**: 同源 iframe');
  if (el.visibleText) lines.push(`- **可见文本**: "${el.visibleText}"`);
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
