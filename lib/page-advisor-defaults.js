/**
 * Alt+E 默认工作空间 / 租户解析（纯函数，无 Chrome API）。
 * 优先级：浮窗当前值 → 弹窗保存的 lastWorkspaceId。
 */

/**
 * @param {{
 *   floatWorkspaceId?: string,
 *   floatCompanyId?: string,
 *   lastWorkspaceId?: string|null,
 *   workspaces?: Array<{ id?: string, _id?: string, company_id?: string, companyId?: string }>,
 * }} input
 * @returns {{ workspaceId: string, companyId: string, source: 'float'|'storage'|'' }}
 */
function resolvePageAdvisorWorkspace(input) {
  const floatWs = String(input?.floatWorkspaceId || '').trim();
  const floatCid = String(input?.floatCompanyId || '').trim();
  if (floatWs && floatCid) {
    return { workspaceId: floatWs, companyId: floatCid, source: 'float' };
  }

  const lastWs = String(input?.lastWorkspaceId || '').trim();
  const list = Array.isArray(input?.workspaces) ? input.workspaces : [];
  if (lastWs && list.length) {
    const ws = list.find((w) => String(w?.id || w?._id || '') === lastWs);
    const cid = String(ws?.company_id || ws?.companyId || '').trim();
    if (ws && cid) {
      return { workspaceId: lastWs, companyId: cid, source: 'storage' };
    }
  }

  if (floatWs && !floatCid && list.length) {
    const ws = list.find((w) => String(w?.id || w?._id || '') === floatWs);
    const cid = String(ws?.company_id || ws?.companyId || '').trim();
    if (cid) {
      return { workspaceId: floatWs, companyId: cid, source: 'float' };
    }
  }

  return { workspaceId: '', companyId: '', source: '' };
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
  resolveDefaultProjectId,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorDefaults;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorDefaults = PageAdvisorDefaults;
}
