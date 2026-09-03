/**
 * 工作空间列表聚合：公司/工作空间去重，以及下拉 option 文案。
 *
 * 每个租户的默认工作空间名称常为「用户的工作空间」。插件把用户全部租户
 * 拼进同一个 <select>，必须用公司名区分，并去掉重复 membership 造成的双份。
 */

function uniqueCompanies(companies) {
  if (!Array.isArray(companies)) return [];
  const seen = new Set();
  const out = [];
  for (const company of companies) {
    if (!company || typeof company !== 'object') continue;
    if (company.is_active === false) continue;
    const cid = String(company.id || company.company_id || '').trim();
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    out.push(company);
  }
  return out;
}

function workspaceIdOf(ws) {
  return String(ws?.id || ws?._id || '').trim();
}

function workspaceDisplayName(ws) {
  return String(ws?.name || ws?.displayName || ws?.title || workspaceIdOf(ws) || '').trim();
}

function unwrapWorkspaceRows(data) {
  if (Array.isArray(data)) return data;
  return data?.results || data?.items || data?.data || [];
}

/**
 * 把某租户的工作空间行追加到 merged；相同工作空间 id 只保留第一次。
 * @param {object[]} merged
 * @param {Set<string>} seenIds
 * @param {object[]} rows
 * @param {{id?: string, company_id?: string, name?: string, company_name?: string}} company
 */
function appendWorkspaceRows(merged, seenIds, rows, company) {
  const cid = String(company?.id || company?.company_id || '').trim();
  const cname = String(company?.name || company?.company_name || '').trim();
  const list = Array.isArray(rows) ? rows : [];
  for (const ws of list) {
    const wid = workspaceIdOf(ws);
    if (!wid || seenIds.has(wid)) continue;
    seenIds.add(wid);
    merged.push({
      ...ws,
      company_id: ws.company_id || ws.companyId || cid,
      company_name: ws.company_name || ws.companyName || cname,
    });
  }
}

function uniqueCompanyIdCount(workspaces) {
  const ids = new Set();
  for (const ws of workspaces) {
    const cid = String(ws?.company_id || ws?.companyId || '').trim();
    if (cid) ids.add(cid);
  }
  return ids.size;
}

function hasDuplicateDisplayNames(workspaces) {
  const counts = new Map();
  for (const ws of workspaces) {
    const name = workspaceDisplayName(ws);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  for (const n of counts.values()) {
    if (n > 1) return true;
  }
  return false;
}

function shouldQualifyWithCompany(workspaces) {
  return uniqueCompanyIdCount(workspaces) > 1 || hasDuplicateDisplayNames(workspaces);
}

/**
 * @param {object[]} workspaces
 * @returns {string[]}
 */
function workspaceOptionLabels(workspaces) {
  const list = Array.isArray(workspaces) ? workspaces : [];
  const qualify = shouldQualifyWithCompany(list);
  const prelim = list.map((ws) => {
    const name = workspaceDisplayName(ws);
    const company = String(ws?.company_name || ws?.companyName || '').trim();
    return qualify && company ? `${name} · ${company}` : name;
  });
  const counts = new Map();
  for (const label of prelim) {
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return prelim.map((label, i) => {
    if (counts.get(label) <= 1) return label;
    const id = workspaceIdOf(list[i]);
    const short = id.slice(-6);
    return short ? `${label} (#${short})` : label;
  });
}

const TENANT_MEMBERSHIP_DENIED_RE = /您不是该公司的成员/;
const MEMBERSHIP_MISMATCH_HINT =
  '您不是该公司的成员。插件登录与网页登录是两套会话：请在扩展弹窗用与网页相同的账号重新登录。';

function isTenantMembershipDenied(err) {
  return TENANT_MEMBERSHIP_DENIED_RE.test(String(err?.message || err || ''));
}

/**
 * 按租户拉工作空间；某一租户 403 成员校验失败时跳过（网页 Cookie 串号 / 过期成员），
 * 其它租户仍返回。调用方在 deniedCount>0 且 merged 为空时抛 MEMBERSHIP_MISMATCH_HINT。
 */
async function loadWorkspacesAcrossCompanies(companies, fetchRowsForCompany) {
  const list = Array.isArray(companies) ? companies : [];
  const merged = [];
  const seenIds = new Set();
  let deniedCount = 0;
  let lastDeniedTraceId = '';
  for (const company of list) {
    const cid = String(company?.id || company?.company_id || '').trim();
    if (!cid) continue;
    let rows;
    try {
      rows = await fetchRowsForCompany(cid);
    } catch (e) {
      if (!isTenantMembershipDenied(e)) throw e;
      deniedCount += 1;
      const tid = String(e?.traceId || '').trim();
      if (tid) lastDeniedTraceId = tid;
      continue;
    }
    appendWorkspaceRows(merged, seenIds, Array.isArray(rows) ? rows : [], company);
  }
  return { merged, deniedCount, lastDeniedTraceId };
}

const WorkspaceList = {
  uniqueCompanies,
  unwrapWorkspaceRows,
  appendWorkspaceRows,
  workspaceDisplayName,
  workspaceOptionLabels,
  shouldQualifyWithCompany,
  isTenantMembershipDenied,
  MEMBERSHIP_MISMATCH_HINT,
  loadWorkspacesAcrossCompanies,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkspaceList;
}
if (typeof globalThis !== 'undefined') {
  globalThis.WorkspaceList = WorkspaceList;
}
