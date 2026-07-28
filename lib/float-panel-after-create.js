/**
 * 浮窗创建任务成功后的收尾逻辑（纯函数，无 DOM / Chrome API）
 * — 打开时快照归一化、成功 toast 文案
 */

/**
 * @typedef {{
 *   workspaceId: string,
 *   projectIds: string[],
 *   title: string,
 *   description: string,
 *   priority: string,
 *   progress_column_id: string,
 *   deliverable_obj_id: string,
 *   container_image_id: string,
 *   feature_params_source: string,
 *   personal_feature_params_config_id: string,
 *   due_date: string,
 *   auto_run: boolean,
 *   repoBaseBranches: Record<string, string>,
 *   assigneeIds: string[],
 *   workBranch: string,
 *   mergeTarget: string,
 * }} FloatOpenSnapshot
 */

/**
 * @param {Partial<FloatOpenSnapshot>|null|undefined} raw
 * @returns {FloatOpenSnapshot}
 */
function normalizeOpenSnapshot(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const repo = r.repoBaseBranches && typeof r.repoBaseBranches === 'object' && !Array.isArray(r.repoBaseBranches)
    ? { ...r.repoBaseBranches }
    : {};
  return {
    workspaceId: String(r.workspaceId || ''),
    projectIds: Array.isArray(r.projectIds) ? r.projectIds.map(String) : [],
    title: String(r.title ?? ''),
    description: String(r.description ?? ''),
    priority: String(r.priority ?? '1'),
    progress_column_id: String(r.progress_column_id || ''),
    deliverable_obj_id: String(r.deliverable_obj_id || ''),
    container_image_id: String(r.container_image_id || ''),
    feature_params_source: String(r.feature_params_source || ''),
    personal_feature_params_config_id: String(r.personal_feature_params_config_id || ''),
    due_date: String(r.due_date || ''),
    auto_run: Boolean(r.auto_run),
    repoBaseBranches: repo,
    assigneeIds: Array.isArray(r.assigneeIds) ? r.assigneeIds.map(String) : [],
    workBranch: String(r.workBranch ?? ''),
    mergeTarget: String(r.mergeTarget ?? ''),
  };
}

/**
 * @param {unknown} taskId
 * @returns {string}
 */
function formatFloatCreateSuccessToast(taskId) {
  const id = taskId == null || taskId === '' ? '(已创建)' : String(taskId);
  return `✅ 任务创建成功! ID: ${id}`;
}

/**
 * @param {unknown} taskId
 * @returns {string}
 */
function extractCreatedTaskId(data) {
  if (!data || typeof data !== 'object') return '(已创建)';
  const id = data.id ?? data._id;
  if (id == null || id === '') return '(已创建)';
  return String(id);
}

const FloatPanelAfterCreate = {
  normalizeOpenSnapshot,
  formatFloatCreateSuccessToast,
  extractCreatedTaskId,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FloatPanelAfterCreate;
}
if (typeof globalThis !== 'undefined') {
  globalThis.FloatPanelAfterCreate = FloatPanelAfterCreate;
}
