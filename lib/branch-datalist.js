'use strict';

/**
 * 逐仓基准分支 datalist：id / 远程分支解析 / option HTML / 填充。
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

/**
 * 填充容器内所有 [data-repo-base] 输入对应的基准分支 datalist。
 * DevTools panel 与浮窗共用（OPT-20260828-016）：给定容器 + 项目列表 +
 * getBranches 调用方，逐 repo 拉取远程分支并写入 datalist，内置 develop/main 恒在。
 * @param {object} opts
 * @param {ParentNode} opts.containerEl 包含 data-repo-base 输入的容器
 * @param {object[]} opts.projects 项目列表（含 git_repos，panel 传入 projectsCache）
 * @param {object} [opts.workspace] 当前工作空间（取 company_id/companyId）
 * @param {(params: {companyId: string, projectId: string, repoUrl: string}) => Promise<unknown>} opts.getBranches
 *        远程分支调用方（如 P.swApi('getBranches', params) / swApi('getBranches', params)）
 * @param {() => Promise<boolean>} [opts.ensureApiReady] 可选预检（panel 登录态）
 * @param {string} [opts.logPrefix] 失败日志前缀
 */
async function populateRepoBaseBranchDatalists({
  containerEl,
  projects = [],
  workspace = null,
  getBranches,
  ensureApiReady,
  logPrefix = '[taskChromePlugin] repo-base getBranches failed',
}) {
  if (!containerEl) return;
  if (typeof getBranches !== 'function') return;
  const companyId = workspace?.company_id || workspace?.companyId;
  if (!companyId) return;
  if (ensureApiReady && !(await ensureApiReady())) return;

  const inputs = containerEl.querySelectorAll('[data-repo-base][data-project-id][list]');
  for (const input of inputs) {
    const projectId = input.getAttribute('data-project-id');
    const repoIndex = Number(input.getAttribute('data-repo-index') || 0);
    const listId = input.getAttribute('list');
    const datalist = listId ? document.getElementById(listId) : null;
    if (!datalist) continue;
    const proj = projects.find((p) => String(p.id || p._id) === String(projectId));
    const repos = Array.isArray(proj?.git_repos)
      ? proj.git_repos.filter((u) => u && String(u).trim())
      : [];
    const repoUrl = repos[repoIndex];
    if (!repoUrl) continue;
    try {
      const resp = await getBranches({
        companyId: String(companyId),
        projectId,
        repoUrl,
      });
      const names = parseRemoteBranchNames(resp);
      datalist.innerHTML = branchDatalistOptionsHtml(names);
    } catch (e) {
      console.warn(logPrefix, {
        projectId,
        repoIndex,
        message: e && e.message ? String(e.message) : 'unknown',
        traceId: e && e.traceId ? String(e.traceId) : '',
      });
    }
  }
}

const BranchDatalist = {
  repoBaseDatalistId,
  parseRemoteBranchNames,
  branchDatalistOptionsHtml,
  populateRepoBaseBranchDatalists,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BranchDatalist;
}
if (typeof globalThis !== 'undefined') {
  globalThis.BranchDatalist = BranchDatalist;
}
