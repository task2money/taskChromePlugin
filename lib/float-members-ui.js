'use strict';

/**
 * 浮窗负责人下拉 / 协作人勾选 HTML（纯函数）。
 */

if (!globalThis.__taskpluginContentBoot?.skip) {
function escAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * @param {object[]} members
 * @param {{ preferredOwnerId?: string, WorkspaceMembers?: object }} [opts]
 * @returns {{ html: string, preferred: string }}
 */
function buildOwnerSelectHtml(members, opts = {}) {
  const list = Array.isArray(members) ? members : [];
  const WM = opts.WorkspaceMembers
    || (typeof globalThis !== 'undefined' ? globalThis.WorkspaceMembers : null);
  if (!list.length) {
    const none = typeof tx === 'function' ? tx('commonNoCollaborators') : '暂无协作人';
    return { html: `<option value="">${none}</option>`, preferred: '' };
  }
  let preferred = String(opts.preferredOwnerId || '').trim();
  if (!preferred && WM && typeof WM.preferDefaultOwnerId === 'function') {
    preferred = WM.preferDefaultOwnerId(list, {
      currentUserId: opts.currentUserId,
      currentMemberId: opts.currentMemberId,
    });
  }
  const pickOwner = typeof tx === 'function' ? tx('commonSelectOwner') : '-- 请选择负责人 --';
  let html = `<option value="">${pickOwner}</option>`;
  for (const m of list) {
    const mid = WM ? WM.memberId(m) : String(m.id || '');
    if (!mid) continue;
    const name = WM ? WM.memberDisplayName(m) : (m.member_name || m.name || mid);
    html += `<option value="${escAttr(mid)}">${escAttr(name)}</option>`;
  }
  return { html, preferred };
}

/**
 * @param {object[]} members
 * @param {{ WorkspaceMembers?: object }} [opts]
 * @returns {string}
 */
function buildAssigneesCheckboxHtml(members, opts = {}) {
  const list = Array.isArray(members) ? members : [];
  if (!list.length) {
    const nm = typeof tx === 'function' ? tx('commonNoMembers') : '暂无成员';
    return `<span style="color:#6c7086;font-size:11px;">${nm}</span>`;
  }
  const WM = opts.WorkspaceMembers
    || (typeof globalThis !== 'undefined' ? globalThis.WorkspaceMembers : null);
  let html = '';
  for (const m of list) {
    const mid = WM ? WM.memberId(m) : String(m.id || '');
    if (!mid) continue;
    const name = WM ? WM.memberDisplayName(m) : (m.member_name || m.name || mid);
    html += `<label><input type="checkbox" class="taskplugin-assignee" value="${escAttr(mid)}"> ${escAttr(name)}</label>`;
  }
  const nm = typeof tx === 'function' ? tx('commonNoMembers') : '暂无成员';
  return html || `<span style="color:#6c7086;font-size:11px;">${nm}</span>`;
}

const FloatMembersUi = {
  buildOwnerSelectHtml,
  buildAssigneesCheckboxHtml,
  escAttr,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FloatMembersUi;
}
if (typeof globalThis !== 'undefined') {
  globalThis.FloatMembersUi = FloatMembersUi;
}
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    escAttr, buildOwnerSelectHtml, buildAssigneesCheckboxHtml,
  });
}
}
