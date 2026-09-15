/**
 * 浮窗：恢复 / 持久化 lastWorkspaceId + lastProjectIds（纯函数 + 薄 DOM 适配）。
 */

/**
 * @param {Array<{id?:string,_id?:string}>} workspaces
 * @param {string|null|undefined} lastWorkspaceId
 * @returns {string}
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
function matchLastWorkspaceId(workspaces, lastWorkspaceId) {
  const last = String(lastWorkspaceId || '').trim();
  if (!last || !Array.isArray(workspaces)) return '';
  return workspaces.some((w) => String(w?.id || w?._id || '') === last) ? last : '';
}

/**
 * @param {HTMLSelectElement|null|undefined} selectEl
 * @param {Array<{id?:string,_id?:string}>} workspaces
 * @param {string|null|undefined} lastWorkspaceId
 * @returns {string} 写入的 workspaceId（空表示未改）
 */
function applyLastWorkspaceToSelect(selectEl, workspaces, lastWorkspaceId) {
  if (!selectEl || selectEl.value) return '';
  const id = matchLastWorkspaceId(workspaces, lastWorkspaceId);
  if (!id) return '';
  selectEl.value = id;
  return id;
}

/**
 * @param {ParentNode|null|undefined} projectsRoot
 * @param {Array<{id?:string,_id?:string}>} projects
 * @param {string[]} lastProjectIds
 * @returns {string} 选中的 project id
 */
function applyLastProjectToRadios(projectsRoot, projects, lastProjectIds) {
  if (!projectsRoot) return '';
  const radios = projectsRoot.querySelectorAll('input.project-radio');
  if (!radios.length) return '';
  const already = Array.from(radios).some((el) => el.checked);
  if (already) return '';
  const pick = (typeof PageAdvisorDefaults !== 'undefined'
    && PageAdvisorDefaults.resolveDefaultProjectId)
    ? PageAdvisorDefaults.resolveDefaultProjectId(lastProjectIds, projects)
    : '';
  if (!pick) return '';
  for (const el of radios) {
    el.checked = el.value === pick;
  }
  return pick;
}

async function persistLastWorkspace(wsId) {
  if (typeof Storage === 'undefined' || !Storage.saveLastWorkspace) return;
  try {
    await Storage.saveLastWorkspace(wsId || null);
  } catch (_) { /* ignore */ }
}

async function persistLastProjectIds(ids) {
  if (typeof Storage === 'undefined' || !Storage.saveLastProjectIds) return;
  try {
    await Storage.saveLastProjectIds(Array.isArray(ids) ? ids : []);
  } catch (_) { /* ignore */ }
}

const FloatLastSelection = {
  matchLastWorkspaceId,
  applyLastWorkspaceToSelect,
  applyLastProjectToRadios,
  persistLastWorkspace,
  persistLastProjectIds,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FloatLastSelection;
}
if (typeof globalThis !== 'undefined') {
  globalThis.FloatLastSelection = FloatLastSelection;
}
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    matchLastWorkspaceId, applyLastWorkspaceToSelect,
    applyLastProjectToRadios, persistLastWorkspace, persistLastProjectIds,
  });
}
}
