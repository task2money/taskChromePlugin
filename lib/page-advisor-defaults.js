/**
 * Alt+Z 默认工作空间 / 租户解析（纯函数，无 Chrome API）。
 * 优先级：浮窗当前值 → 手选保存的 lastWorkspaceId → 平台默认工作空间 → 自动选中的 lastWorkspaceId。
 */

if (!globalThis.__taskpluginContentBoot?.skip) {
// 平台默认工作空间解析的 SSOT 在 lib/popup-saas-workspace.js（弹窗与 SW 共用）。
// Node（单测）走 require 明确取用；浏览器/SW 走 importScripts 建立的全局 —— 未加载时
// 返回空串，调用方按「没有默认」处理，行为与本次改造前一致（不猜、不乱选）。
function platformDefaultWorkspaceMenu() {
  if (typeof module !== 'undefined' && module.exports) {
    try {
      return require('./popup-saas-workspace.js');
    } catch (_) {
      return null;
    }
  }
  return (typeof globalThis !== 'undefined' && globalThis.PopupSaasWorkspaceMenu) || null;
}

/**
 * 平台默认工作空间 id：工作空间列表里 is_default 为真的那一个，多租户时优先 is_current。
 * SSOT 见 lib/popup-saas-workspace.js 的 pickPlatformDefaultWorkspaceId（同一实现）。
 * @param {Array<{id?:string,_id?:string,is_default?:unknown,is_current?:unknown}>} workspaces
 * @returns {string} 默认工作空间 id；无法确定（含 SSOT 未加载）时为空串
 */
function pickPlatformDefaultWorkspaceId(workspaces) {
  const menu = platformDefaultWorkspaceMenu();
  if (!menu || typeof menu.pickPlatformDefaultWorkspaceId !== 'function') return '';
  return menu.pickPlatformDefaultWorkspaceId(workspaces);
}

/**
 * @param {{
 *   floatWorkspaceId?: string,
 *   floatCompanyId?: string,
 *   lastWorkspaceId?: string|null,
 *   lastWorkspaceManual?: boolean|null,
 *   workspaces?: Array<{ id?: string, _id?: string, company_id?: string, companyId?: string,
 *     is_default?: unknown, is_current?: unknown }>,
 * }} input
 * @returns {{ workspaceId: string, companyId: string, source: 'float'|'storage'|'default'|'' }}
 */
function resolvePageAdvisorWorkspace(input) {
  const list = Array.isArray(input?.workspaces) ? input.workspaces : [];
  const companyOf = (id) => {
    const ws = list.find((w) => String(w?.id || w?._id || '') === id);
    return ws ? String(ws?.company_id || ws?.companyId || '').trim() : '';
  };

  const floatWs = String(input?.floatWorkspaceId || '').trim();
  const floatCid = String(input?.floatCompanyId || '').trim();
  if (floatWs && floatCid) {
    return { workspaceId: floatWs, companyId: floatCid, source: 'float' };
  }

  const lastWs = String(input?.lastWorkspaceId || '').trim();
  const lastCid = lastWs ? companyOf(lastWs) : '';
  // 手选优先：lastWorkspaceManual === false 表示这个 id 是插件自动选中的（可被平台默认覆盖）；
  // null / 未提供（旧值、浮窗、批量创建）按手选处理，兼容既有行为。
  const manual = input?.lastWorkspaceManual !== false;
  if (lastWs && lastCid && manual) {
    return { workspaceId: lastWs, companyId: lastCid, source: 'storage' };
  }

  if (floatWs && !floatCid) {
    const cid = companyOf(floatWs);
    if (cid) {
      return { workspaceId: floatWs, companyId: cid, source: 'float' };
    }
  }

  // 未手选过（或保存的只是自动选中）→ 跟随平台默认工作空间。
  // 列表为空（接口失败）时拿不到默认，继续往下走，保持既有提示而不是静默乱选。
  const defId = pickPlatformDefaultWorkspaceId(list);
  const defCid = defId ? companyOf(defId) : '';
  if (defId && defCid) {
    return { workspaceId: defId, companyId: defCid, source: 'default' };
  }

  if (lastWs && lastCid) {
    return { workspaceId: lastWs, companyId: lastCid, source: 'storage' };
  }

  return { workspaceId: '', companyId: '', source: '' };
}

/**
 * 从工作空间列表里挑出「这次该用哪一个条目」：上次选过的 id 命中 → 用它；
 * 否则平台默认工作空间（is_default，多租户优先 is_current）；再否则第一项。
 * @param {Array<object>} workspaces
 * @param {string|null|undefined} lastWorkspaceId
 * @returns {object|null} 命中的工作空间原始条目；列表为空时 null
 */
function pickWorkspaceEntry(workspaces, lastWorkspaceId) {
  const list = Array.isArray(workspaces) ? workspaces : [];
  const idOf = (ws) => String(ws?.id || ws?._id || '').trim();
  const last = String(lastWorkspaceId || '').trim();
  if (last) {
    const hit = list.find((ws) => idOf(ws) === last);
    if (hit) return hit;
  }
  const defId = pickPlatformDefaultWorkspaceId(list);
  if (defId) {
    const def = list.find((ws) => idOf(ws) === defId);
    if (def) return def;
  }
  return list[0] || null;
}

/**
 * @param {string[]} lastProjectIds
 * @param {Array<{ id?: string, _id?: string }>} projects
 * @returns {string} 单个默认项目 id（浮窗/弹窗均为单选）
 */
function resolveDefaultProjectId(lastProjectIds, projects) {
  const available = (Array.isArray(projects) ? projects : [])
    .map((p) => String(p?.id || p?._id || '').trim())
    .filter(Boolean);
  const preferred = (Array.isArray(lastProjectIds) ? lastProjectIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (typeof ProjectAutoRunLabel !== 'undefined'
    && typeof ProjectAutoRunLabel.pickSingleProjectId === 'function') {
    return ProjectAutoRunLabel.pickSingleProjectId(preferred, available) || '';
  }
  for (const id of preferred) {
    if (available.includes(id)) return id;
  }
  return available[0] || '';
}

const PageAdvisorDefaults = {
  resolvePageAdvisorWorkspace,
  pickPlatformDefaultWorkspaceId,
  pickWorkspaceEntry,
  resolveDefaultProjectId,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorDefaults;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorDefaults = PageAdvisorDefaults;
}
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    resolvePageAdvisorWorkspace, pickPlatformDefaultWorkspaceId, pickWorkspaceEntry,
    resolveDefaultProjectId,
  });
}
}
