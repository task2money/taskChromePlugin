/**
 * 任务详情链接构造（纯函数，无 DOM / Chrome API）。
 *
 * 浮窗创建成功 toast 与 DevTools 面板成功提示共用同一 URL 契约：
 *   {origin}/tenant/{companyId}/workspace/{workspaceId}/task-detail/{taskId}/
 *
 * 从 lib/float-panel-after-create.js 抽出（OPT-20260921-028），使面板侧可复用；
 * 该文件保留同名转发与全局导出，既有调用方与单测不受影响。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
/**
 * @param {unknown} baseUrl
 * @returns {string} http(s) origin or ''
 */
function originFromApiBaseUrl(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin;
  } catch (_) {
    return '';
  }
}

/**
 * @param {unknown[]} workspaces
 * @param {unknown} workspaceId
 * @returns {string}
 */
function companyIdOfWorkspace(workspaces, workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid || !Array.isArray(workspaces)) return '';
  for (const ws of workspaces) {
    if (!ws || typeof ws !== 'object') continue;
    const id = String(ws.id || ws._id || '').trim();
    if (id !== wid) continue;
    return String(ws.company_id || ws.companyId || '').trim();
  }
  return '';
}

/**
 * @param {unknown} taskId
 * @returns {boolean}
 */
function isLinkableCreatedTaskId(taskId) {
  const id = String(taskId == null ? '' : taskId).trim();
  if (!id) return false;
  if (id === tx('floatCreatedNoId')) return false;
  if (/[/?#\\]/.test(id)) return false;
  return true;
}

/**
 * 工作面板任务详情：/tenant/{companyId}/workspace/{workspaceId}/task-detail/{taskId}/
 * @param {{ baseUrl?: unknown, companyId?: unknown, workspaceId?: unknown, taskId?: unknown }} opts
 * @returns {string}
 */
function buildTaskDetailHref(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const origin = originFromApiBaseUrl(o.baseUrl);
  const companyId = String(o.companyId || '').trim();
  const workspaceId = String(o.workspaceId || '').trim();
  const taskId = String(o.taskId || '').trim();
  if (!origin || !companyId || !workspaceId || !isLinkableCreatedTaskId(taskId)) return '';
  return (
    `${origin}/tenant/${encodeURIComponent(companyId)}`
    + `/workspace/${encodeURIComponent(workspaceId)}`
    + `/task-detail/${encodeURIComponent(taskId)}/`
  );
}

/**
 * 把含任务 ID 的成功文案切成可渲染片段，供各入口自建 `<a>`。
 * 不可链接（无 href / 非 http(s) / id 不可链接 / 文案不含 id）时退回纯文本。
 * @param {unknown} text
 * @param {unknown} taskId
 * @param {unknown} href
 * @returns {{ kind: 'link', before: string, linkText: string, href: string, after: string } | { kind: 'text', text: string }}
 */
function buildLinkParts(text, taskId, href) {
  const full = String(text == null ? '' : text);
  const id = taskId == null || taskId === '' ? tx('floatCreatedNoId') : String(taskId);
  const link = String(href || '').trim();
  if (!link || !isLinkableCreatedTaskId(id) || !/^https?:\/\//i.test(link)) {
    return { kind: 'text', text: full };
  }
  const idx = full.lastIndexOf(id);
  if (idx < 0) return { kind: 'text', text: full };
  return {
    kind: 'link',
    before: full.slice(0, idx),
    linkText: id,
    href: link,
    after: full.slice(idx + id.length),
  };
}

const TaskDetailHref = {
  originFromApiBaseUrl,
  companyIdOfWorkspace,
  isLinkableCreatedTaskId,
  buildTaskDetailHref,
  buildLinkParts,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TaskDetailHref;
}
if (typeof globalThis !== 'undefined') {
  globalThis.TaskDetailHref = TaskDetailHref;
}
}
