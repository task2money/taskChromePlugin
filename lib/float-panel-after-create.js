/**
 * 浮窗创建任务成功后的收尾逻辑（纯函数，无 DOM / Chrome API）
 * — 打开时快照归一化、成功 toast 文案与任务详情链接
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
 *   ownerId: string,
 *   assigneeIds: string[],
 *   workBranch: string,
 *   mergeTarget: string,
 * }} FloatOpenSnapshot
 */

/**
 * @param {Partial<FloatOpenSnapshot>|null|undefined} raw
 * @returns {FloatOpenSnapshot}
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
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
    ownerId: String(r.ownerId || r.owner || ''),
    assigneeIds: Array.isArray(r.assigneeIds) ? r.assigneeIds.map(String) : [],
    workBranch: String(r.workBranch ?? ''),
    mergeTarget: String(r.mergeTarget ?? ''),
  };
}

/** 创建成功页内 toast 展示时长（毫秒） */
const FLOAT_CREATE_SUCCESS_TOAST_MS = 5000;

/**
 * @param {unknown} taskId
 * @returns {string}
 */
function formatFloatCreateSuccessToast(taskId) {
  const id = taskId == null || taskId === '' ? tx('floatCreatedNoId') : String(taskId);
  return tx('floatCreateSuccess', { id });
}

/**
 * @param {unknown} data
 * @returns {string}
 */
function extractCreatedTaskId(data) {
  if (!data || typeof data !== 'object') return tx('floatCreatedNoId');
  const id = data.id ?? data._id;
  if (id == null || id === '') return tx('floatCreatedNoId');
  return String(id);
}

/**
 * @param {unknown[]} workspaces
 * @param {unknown} workspaceId
 * @returns {string}
 */
function companyIdOfWorkspace(workspaces, workspaceId) {
  return HrefLib().companyIdOfWorkspace(workspaces, workspaceId);
}

/**
 * @param {unknown} taskId
 * @returns {boolean}
 */
function isLinkableCreatedTaskId(taskId) {
  return HrefLib().isLinkableCreatedTaskId(taskId);
}

/** 链接构造已抽到 lib/task-detail-href.js（OPT-20260921-028），此处仅转发。 */
function HrefLib() {
  if (typeof module !== 'undefined' && module.exports) return require('./task-detail-href.js');
  return globalThis.TaskDetailHref;
}

/**
 * @param {unknown} baseUrl
 * @returns {string} http(s) origin or ''
 */
function originFromApiBaseUrl(baseUrl) {
  return HrefLib().originFromApiBaseUrl(baseUrl);
}

/**
 * 工作面板任务详情：/tenant/{companyId}/workspace/{workspaceId}/task-detail/{taskId}/
 * @param {{ baseUrl?: unknown, companyId?: unknown, workspaceId?: unknown, taskId?: unknown }} opts
 * @returns {string}
 */
function buildTaskDetailHref(opts) {
  return HrefLib().buildTaskDetailHref(opts);
}

/**
 * @param {unknown} taskId
 * @param {unknown} href
 * @returns {{ kind: 'link', before: string, linkText: string, href: string, after: string } | { kind: 'text', text: string }}
 */
function buildFloatCreateSuccessToastParts(taskId, href) {
  return HrefLib().buildLinkParts(formatFloatCreateSuccessToast(taskId), taskId, href);
}

/**
 * @param {{ data?: unknown, baseUrl?: unknown, workspaces?: unknown[], workspaceId?: unknown }} opts
 * @returns {{ text: string, parts: object, durationMs: number }}
 */
function buildFloatCreateSuccessToastView(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const taskId = extractCreatedTaskId(o.data);
  const href = buildTaskDetailHref({
    baseUrl: o.baseUrl,
    companyId: companyIdOfWorkspace(o.workspaces, o.workspaceId),
    workspaceId: o.workspaceId,
    taskId,
  });
  const parts = buildFloatCreateSuccessToastParts(taskId, href);
  return {
    text: formatFloatCreateSuccessToast(taskId),
    parts,
    durationMs: FLOAT_CREATE_SUCCESS_TOAST_MS,
  };
}

const FloatPanelAfterCreate = {
  normalizeOpenSnapshot,
  formatFloatCreateSuccessToast,
  extractCreatedTaskId,
  companyIdOfWorkspace,
  originFromApiBaseUrl,
  isLinkableCreatedTaskId,
  buildTaskDetailHref,
  buildFloatCreateSuccessToastParts,
  buildFloatCreateSuccessToastView,
  FLOAT_CREATE_SUCCESS_TOAST_MS,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FloatPanelAfterCreate;
}
if (typeof globalThis !== 'undefined') {
  globalThis.FloatPanelAfterCreate = FloatPanelAfterCreate;
}
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    normalizeOpenSnapshot, formatFloatCreateSuccessToast,
    extractCreatedTaskId, companyIdOfWorkspace, originFromApiBaseUrl,
    isLinkableCreatedTaskId, buildTaskDetailHref, buildFloatCreateSuccessToastParts,
    buildFloatCreateSuccessToastView, FLOAT_CREATE_SUCCESS_TOAST_MS,
  });
}
}
