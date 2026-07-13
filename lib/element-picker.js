/**
 * 页面元素选择 — 纯函数（描述格式化 / 追加 / 校验）
 * 无 Chrome API 依赖；content script 与 node --test 共用
 */

const MAX_TEXT = 120;
const MAX_OUTER = 240;

function truncateText(str, max = MAX_TEXT) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * @param {{ tagName?: string, id?: string, className?: string|string[] }} parts
 * @returns {string}
 */
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

/**
 * @param {Array<{ tagName: string, id?: string, className?: string|string[], nthOfType?: number }>} chain
 *   从根到叶的祖先链
 * @returns {string}
 */
function buildCssPath(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return '';
  return chain
    .map((node) => {
      const tag = String(node.tagName || '*').toLowerCase();
      if (node.id) return `${tag}#${CSS_escapeId(node.id)}`;
      const classes = normalizeClassList(node.className)
        .slice(0, 2)
        .map((c) => `.${CSS_escapeClass(c)}`)
        .join('');
      const nth = node.nthOfType != null && node.nthOfType > 1
        ? `:nth-of-type(${node.nthOfType})`
        : '';
      return `${tag}${classes}${nth}`;
    })
    .join(' > ');
}

/**
 * 从真实 DOM Element 构建祖先链（content script 用；单测可注入 mock）
 * @param {Element} el
 * @param {(n: Node) => boolean} [isExcluded]
 */
function buildAncestorChain(el, isExcluded) {
  const chain = [];
  let cur = el;
  while (cur && cur.nodeType === 1) {
    if (typeof isExcluded === 'function' && isExcluded(cur)) break;
    if (cur === document.documentElement) {
      chain.unshift({
        tagName: 'html',
        id: cur.id || '',
        className: cur.className || '',
        nthOfType: 1,
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
    });
    if (cur.id) break; // 有 id 可截断，缩短选择器
    cur = cur.parentElement;
  }
  return chain;
}

/**
 * @param {Element} el
 * @returns {object}
 */
function snapshotElement(el) {
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

  return {
    tagName,
    id: el.id || '',
    className,
    label: buildElementLabel({ tagName, id: el.id, className }),
    cssPath: buildCssPath(chain),
    visibleText,
    outerHtmlSnippet,
    isSensitive,
  };
}

/**
 * @param {string} adjustment
 * @returns {string|null} 错误信息；null 表示通过
 */
function validateAdjustment(adjustment) {
  const t = String(adjustment || '').trim();
  if (!t) return '请填写希望对该元素做什么调整';
  if (t.length > 2000) return '调整期望过长（最多 2000 字）';
  return null;
}

/**
 * @param {{
 *   pageUrl: string,
 *   pageTitle?: string,
 *   element: {
 *     label: string,
 *     cssPath?: string,
 *     visibleText?: string,
 *     outerHtmlSnippet?: string,
 *   },
 *   adjustment: string,
 * }} payload
 */
function formatElementAdjustmentBlock(payload) {
  const pageUrl = String(payload?.pageUrl || '').trim();
  if (!pageUrl) throw new Error('formatElementAdjustmentBlock: pageUrl 必填');
  const adjErr = validateAdjustment(payload?.adjustment);
  if (adjErr) throw new Error(adjErr);
  const el = payload.element;
  if (!el?.label) throw new Error('formatElementAdjustmentBlock: element.label 必填');

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
  if (el.visibleText) lines.push(`- **可见文本**: "${el.visibleText}"`);
  if (el.outerHtmlSnippet) {
    lines.push(`- **HTML 片段**: \`${el.outerHtmlSnippet}\``);
  }
  lines.push(`- **调整期望**: ${String(payload.adjustment).trim()}`);
  return lines.join('\n');
}

/**
 * @param {string} existingDesc
 * @param {Parameters<typeof formatElementAdjustmentBlock>[0]} payload
 */
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
  buildAncestorChain,
  snapshotElement,
  validateAdjustment,
  formatElementAdjustmentBlock,
  appendElementAdjustmentToDescription,
  MAX_TEXT,
  MAX_OUTER,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ElementPicker;
}
if (typeof globalThis !== 'undefined') {
  globalThis.ElementPicker = ElementPicker;
}
