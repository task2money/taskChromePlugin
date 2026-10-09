/**
 * 页面优化建议 → 浮窗任务描述填充（纯函数）。
 * 多选按勾选顺序拼入结构化 markdown 区块；仅改描述字符串，不提交任务。
 * 锚点字段与指针选择（element-picker）对齐：元素 / 选择器 / 可见文本 / HTML 片段 / 调整期望。
 */

'use strict';

/**
 * @param {{ id?: string, title?: string, summary?: string, detail?: string }[]} suggestions
 * @param {string[]} selectedIds 勾选顺序
 * @returns {object[]}
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
function orderSelectedSuggestions(suggestions, selectedIds) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  const byId = new Map();
  for (const s of list) {
    if (s && s.id != null) byId.set(String(s.id), s);
  }
  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  const ordered = [];
  for (const id of ids) {
    const hit = byId.get(String(id));
    if (hit) ordered.push(hit);
  }
  return ordered;
}

/**
 * @param {object[]} suggestions 已按勾选顺序排列
 * @param {string} [pageUrl]
 * @returns {string}
 */
const PA_FILL_BLOCK_NOTE = '锚点全部相对于生成建议时的页面（元素 / 选择器 / 可见文本 / HTML 片段）。按锚点在源码中定位后一次性应用；不要执行一条后重新抓页面，再按旧文案查找下一条。';

function paFillElementLabel(s) {
  const label = String(s?.label || '').trim();
  if (label) return label;
  const tag = String(s?.tag || 'element').trim() || 'element';
  const id = String(s?.dom_id || '').trim();
  return id ? `${tag}#${id}` : tag;
}

function paFillExpectation(s) {
  const title = String(s?.title || '').trim() || '建议';
  const detail = String(s?.detail || s?.summary || '').trim();
  if (!detail) return title;
  if (detail === title || detail.startsWith(`${title}：`) || detail.startsWith(`${title}:`)) {
    return detail;
  }
  return `${title}：${detail}`;
}

function paFillSharesTarget(a, b) {
  if (!a || !b || a === b) return false;
  const at = String(a.target_nid || '');
  const bt = String(b.target_nid || '');
  if (at && at === bt) return true;
  const aa = Array.isArray(a.ancestor_nids) ? a.ancestor_nids.map(String) : [];
  const ba = Array.isArray(b.ancestor_nids) ? b.ancestor_nids.map(String) : [];
  if (at && ba.includes(at)) return true;
  if (bt && aa.includes(bt)) return true;
  return false;
}

function formatOneSuggestionAnchors(s, list) {
  const lines = [];
  lines.push(`- **元素**: \`${paFillElementLabel(s)}\``);
  const cssPath = String(s?.css_path || '').trim();
  if (cssPath) lines.push(`- **选择器**: \`${cssPath}\``);
  const visible = String(s?.visible_text || s?.anchor_text || s?.outline_text || '').trim();
  if (visible) lines.push(`- **可见文本**: "${visible}"`);
  const html = String(s?.html_snippet || '').trim();
  if (html) lines.push(`- **HTML 片段**: \`${html}\``);
  lines.push(`- **调整期望**: ${paFillExpectation(s)}`);
  const peers = list.filter((o) => paFillSharesTarget(s, o));
  if (peers.length) {
    const names = peers.map((p) => p.title || p.id).filter(Boolean).join('、');
    lines.push(`  同目标: 与「${names}」指向同一元素或父子节点，请一次改完`);
  }
  return lines;
}

function formatSuggestionsBlock(suggestions, pageUrl) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  const lines = ['## 页面优化建议（Alt+Z）', PA_FILL_BLOCK_NOTE];
  for (let i = 0; i < list.length; i += 1) {
    if (i > 0) lines.push('');
    lines.push(...formatOneSuggestionAnchors(list[i] || {}, list));
  }
  const url = String(pageUrl || '').trim();
  if (url) lines.push(`来源页: ${url}`);
  return lines.join('\n');
}

function fillSuccessText(mode, copied, tx) {
  const all = mode === 'all';
  const base = typeof tx === 'function'
    ? tx(all ? 'paFillAllSuccess' : 'paFillOneSuccess')
    : (all
      ? '已将优化建议填入任务描述（未自动创建任务）'
      : '已填入一条建议（未自动创建任务）');
  if (!copied) return base;
  const suffix = typeof tx === 'function' ? tx('floatPickCopiedSuffix') : '，并已复制到剪贴板';
  return `${base}${suffix}`;
}

async function copySuggestionsBlock(text, writeText) {
  try {
    if (typeof writeText !== 'function') return false;
    await writeText(String(text || ''));
    return true;
  } catch (err) {
    console.warn('[taskChromePlugin] page_advisor_clipboard_failed', {
      error: err && err.message ? err.message : String(err),
    });
    return false;
  }
}

/**
 * 将多选建议追加到已有描述（不覆盖原文）。
 * @param {string} existingDesc
 * @param {object[]} suggestions 全量列表
 * @param {string[]} selectedIds 勾选顺序
 * @param {string} [pageUrl]
 * @returns {string}
 */
function appendSuggestionsToDescription(existingDesc, suggestions, selectedIds, pageUrl, contentPrefix) {
  const ordered = orderSelectedSuggestions(suggestions, selectedIds);
  if (!ordered.length) {
    return String(existingDesc || '');
  }
  let block = formatSuggestionsBlock(ordered, pageUrl);
  if (typeof PageAdvisorDelivery !== 'undefined' && PageAdvisorDelivery.prependContentPrefix) {
    block = PageAdvisorDelivery.prependContentPrefix(block, contentPrefix);
  }
  const base = String(existingDesc || '').trimEnd();
  if (!base) return block;
  return `${base}\n\n${block}`;
}

const PageAdvisorFill = {
  orderSelectedSuggestions,
  formatSuggestionsBlock,
  appendSuggestionsToDescription,
  copySuggestionsBlock,
  fillSuccessText,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorFill;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorFill = PageAdvisorFill;
}
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    orderSelectedSuggestions, formatSuggestionsBlock,
    appendSuggestionsToDescription, copySuggestionsBlock, fillSuccessText,
  });
}
}
