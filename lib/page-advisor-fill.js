/**
 * 页面优化建议 → 浮窗任务描述填充（纯函数）。
 * 多选按勾选顺序拼入结构化 markdown 区块；仅改描述字符串，不提交任务。
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
const PA_FILL_BLOCK_NOTE = '锚点全部相对于生成建议时的页面。按锚点在源码中定位后一次性应用；不要执行一条后重新抓页面，再按旧文案查找下一条。';

function paFillAnchorLine(s) {
  const tag = s.tag || 'element';
  const text = String(s.anchor_text || s.outline_text || '').trim();
  const parts = [tag];
  if (text) parts.push(`「${text}」`);
  if (s.dom_id) parts.push(`id=${s.dom_id}`);
  if (s.testid) parts.push(`data-testid=${s.testid}`);
  if (s.aria_label) parts.push(`aria-label=${s.aria_label}`);
  let line = `  锚点: ${parts.join(' ')}`;
  if (s.landmark) line += ` 位于 ${s.landmark}`;
  return line;
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

function formatSuggestionsBlock(suggestions, pageUrl) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  const lines = ['## 页面优化建议（Alt+Z）', PA_FILL_BLOCK_NOTE];
  for (const s of list) {
    const title = String(s?.title || '').trim() || '建议';
    const detail = String(s?.detail || s?.summary || '').trim();
    lines.push(`- [${title}] ${detail}`);
    lines.push(paFillAnchorLine(s || {}));
    if (s?.css_path) {
      lines.push(`  路径(辅助，相对采集时页面): ${s.css_path}`);
    }
    const peers = list.filter((o) => paFillSharesTarget(s, o));
    if (peers.length) {
      const names = peers.map((p) => p.title || p.id).filter(Boolean).join('、');
      lines.push(`  同目标: 与「${names}」指向同一元素或父子节点，请一次改完`);
    }
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
function appendSuggestionsToDescription(existingDesc, suggestions, selectedIds, pageUrl) {
  const ordered = orderSelectedSuggestions(suggestions, selectedIds);
  if (!ordered.length) {
    return String(existingDesc || '');
  }
  const block = formatSuggestionsBlock(ordered, pageUrl);
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
