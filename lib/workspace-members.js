'use strict';

/**
 * 工作空间协作人 / 租户成员列表的纯函数工具。
 * 与 Panel `renderMemberOptions` 对齐：workspace-collaborators 用 `user`，
 * company_members 用 `user_id` / `userId`。
 */

/**
 * @param {object|null|undefined} member
 * @returns {string}
 */
function memberUserId(member) {
  if (!member || typeof member !== 'object') return '';
  return String(member.user || member.user_id || member.userId || '').trim();
}

/**
 * @param {object|null|undefined} member
 * @returns {string}
 */
function memberId(member) {
  if (!member || typeof member !== 'object') return '';
  const id = member.id ?? member._id;
  return id == null ? '' : String(id).trim();
}

/**
 * @param {object|null|undefined} member
 * @returns {string}
 */
function memberDisplayName(member) {
  if (!member || typeof member !== 'object') return '';
  const id = memberId(member);
  return String(member.member_name || member.name || id || '').trim() || id;
}

/**
 * 为负责人下拉挑选默认 member id（与 Panel 一致）。
 * @param {object[]} members
 * @param {{ currentUserId?: string, currentMemberId?: string }} [prefs]
 * @returns {string}
 */
function preferDefaultOwnerId(members, prefs = {}) {
  const list = Array.isArray(members) ? members : [];
  const currentMemberId = String(prefs.currentMemberId || '').trim();
  if (currentMemberId && list.some((m) => memberId(m) === currentMemberId)) {
    return currentMemberId;
  }
  const currentUserId = String(prefs.currentUserId || '').trim();
  if (currentUserId) {
    const mine = list.find((m) => memberUserId(m) === currentUserId);
    const mid = memberId(mine);
    if (mid) return mid;
  }
  if (list.length === 1) return memberId(list[0]);
  return '';
}

/**
 * 归一化 getMembers / collaborators 响应为数组。
 * @param {unknown} data
 * @returns {object[]}
 */
function unwrapMembersResponse(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const nested = data.members || data.results || data.data;
  return Array.isArray(nested) ? nested : [];
}

const WorkspaceMembers = {
  memberUserId,
  memberId,
  memberDisplayName,
  preferDefaultOwnerId,
  unwrapMembersResponse,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkspaceMembers;
}
if (typeof globalThis !== 'undefined') {
  globalThis.WorkspaceMembers = WorkspaceMembers;
}
