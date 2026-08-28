'use strict';

/**
 * 逐仓基准分支 datalist：id / 远程分支解析 / option HTML。
 * 供 create-task-payload 渲染、panel/float 填充远程分支共用。
 */

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function repoBaseDatalistId(projectId, repoIndex) {
  const safe = String(projectId || '').replace(/[^A-Za-z0-9_-]/g, '_');
  return `repo-base-list-${safe}-${Number(repoIndex) || 0}`;
}

function parseRemoteBranchNames(resp) {
  const raw = Array.isArray(resp?.branches) ? resp.branches : (Array.isArray(resp) ? resp : []);
  const names = [];
  const seen = new Set();
  for (const b of raw) {
    const name = typeof b === 'string'
      ? String(b).trim()
      : String(b?.name || b?.branch_name || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function branchDatalistOptionsHtml(names) {
  const seen = new Set();
  let html = '';
  for (const n of ['develop', 'main', ...(names || [])]) {
    const name = String(n || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    html += `<option value="${escapeAttr(name)}"></option>`;
  }
  return html;
}

const BranchDatalist = {
  repoBaseDatalistId,
  parseRemoteBranchNames,
  branchDatalistOptionsHtml,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BranchDatalist;
}
if (typeof globalThis !== 'undefined') {
  globalThis.BranchDatalist = BranchDatalist;
}
