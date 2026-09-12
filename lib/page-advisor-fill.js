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
function formatSuggestionsBlock(suggestions, pageUrl) {
  const lines = ['## 页面优化建议（Alt+E）'];
  const list = Array.isArray(suggestions) ? suggestions : [];
  for (const s of list) {
    const title = String(s?.title || '').trim() || '建议';
    const detail = String(s?.detail || s?.summary || '').trim();
    lines.push(`- [${title}] ${detail}`);
  }
  const url = String(pageUrl || '').trim();
  if (url) {
    lines.push(`来源页: ${url}`);
  }
  return lines.join('\n');
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
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorFill;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorFill = PageAdvisorFill;
}
