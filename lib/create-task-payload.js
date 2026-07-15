/**
 * 创建任务 payload 构建 — 与 work-panel CreateTaskModal / WorkPanel.submitDeliverableForm 对齐
 * 纯函数，无 Chrome API 依赖；DevTools / content / node --test 共用
 */

const FEATURE_PARAMS_SOURCES = new Set(['company', 'workspace', 'personal']);

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateTimeLocal(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * 默认截止日期：当前 +7 天后再对齐到周四（与 workPanelBranchHelpers.getDefaultTaskDeadline 一致）
 * @param {Date} [now]
 */
function getDefaultTaskDeadline(now = new Date()) {
  const targetDate = new Date(now.getTime());
  targetDate.setSeconds(0, 0);
  targetDate.setDate(targetDate.getDate() + 7);
  const daysUntilThursday = (4 - targetDate.getDay() + 7) % 7;
  targetDate.setDate(targetDate.getDate() + daysUntilThursday);
  return formatDateTimeLocal(targetDate);
}

/**
 * 优先级：与 work-panel 一致 — 0=高 1=中 2=低
 * @param {unknown} raw
 * @returns {0|1|2}
 */
function normalizePriority(raw) {
  if (raw === 0 || raw === '0') return 0;
  if (raw === 1 || raw === '1') return 1;
  if (raw === 2 || raw === '2') return 2;
  const key = String(raw || '').trim().toLowerCase();
  if (key === 'high' || key === 'critical') return 0;
  if (key === 'medium') return 1;
  if (key === 'low') return 2;
  return 1;
}

function normalizeFeatureParamsSource(raw) {
  const source = String(raw ?? '').trim();
  if (!source || source === 'none') return '';
  return FEATURE_PARAMS_SOURCES.has(source) ? source : '';
}

/**
 * @param {{ feature_params_source?: unknown, personal_feature_params_config_id?: unknown }} task
 */
function buildFeatureParamsFields(task = {}) {
  const source = normalizeFeatureParamsSource(task.feature_params_source);
  if (!source) return {};
  if (source === 'personal') {
    const configId = String(task.personal_feature_params_config_id || '').trim();
    if (!configId) return {};
    return {
      feature_params_source: source,
      personal_feature_params_config_id: configId,
    };
  }
  return { feature_params_source: source };
}

/**
 * 将勾选项目展开为 API projects[]（含 repo_index），对齐 workPanelBranchHelpers.buildBranchStrategyProjectMappings
 *
 * 基准分支优先级（高→低）：
 * 1. projectSelections[].repoBranches[].baseBranch
 * 2. repoBaseBranches["projectId:repoIndex"]
 * 3. 全局 baseBranch
 * 4. 项目 base_branch / default_branch
 * 5. "main"
 */
function repoBaseBranchKey(projectId, repoIndex) {
  return `${String(projectId)}:${Number(repoIndex) || 0}`;
}

function normalizeAssignees(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const id of raw) {
    const s = String(id || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function shortenRepoLabel(url, index) {
  const raw = String(url || '').trim();
  if (!raw) return `仓库 ${index + 1}`;
  try {
    const u = new URL(raw.replace(/^git@([^:]+):/, 'https://$1/'));
    const path = (u.pathname || '').replace(/\.git$/, '').replace(/^\//, '');
    return path ? `仓库 ${index + 1}：${path}` : `仓库 ${index + 1}：${u.hostname}`;
  } catch (_) {
    return raw.length > 48 ? `仓库 ${index + 1}：${raw.slice(0, 45)}…` : `仓库 ${index + 1}：${raw}`;
  }
}

function resolveBaseForRepo({
  projectId,
  repoIndex,
  project,
  globalBase = '',
  repoBaseBranches = {},
  projectSelections = [],
}) {
  const selections = Array.isArray(projectSelections) ? projectSelections : [];
  const sel = selections.find((s) => String(s?.projectId || s?.project_id) === String(projectId));
  const repoBranches = Array.isArray(sel?.repoBranches) ? sel.repoBranches : [];
  const fromSel = repoBranches.find((r) => Number(r.repoIndex) === Number(repoIndex))
    || repoBranches[repoIndex];
  if (fromSel?.baseBranch != null && String(fromSel.baseBranch).trim() !== '') {
    return String(fromSel.baseBranch).trim();
  }

  const key = repoBaseBranchKey(projectId, repoIndex);
  const fromMap = repoBaseBranches && repoBaseBranches[key];
  if (fromMap != null && String(fromMap).trim() !== '') {
    return String(fromMap).trim();
  }

  const overrideBase = String(globalBase || '').trim();
  if (overrideBase) return overrideBase;

  if (project?.base_branch && String(project.base_branch).trim()) {
    return String(project.base_branch).trim();
  }
  if (project?.default_branch && String(project.default_branch).trim()) {
    return String(project.default_branch).trim();
  }
  return 'main';
}

function buildProjectsFromSelection({
  projectIds = [],
  projectsList = [],
  workBranch = '',
  baseBranch = '',
  repoBaseBranches = {},
  projectSelections = [],
} = {}) {
  const target = String(workBranch || '').trim();
  const out = [];
  for (const pid of projectIds) {
    const projectId = String(pid || '').trim();
    if (!projectId) continue;
    const proj = projectsList.find((p) => String(p.id || p._id) === projectId);
    const repos = Array.isArray(proj?.git_repos)
      ? proj.git_repos.filter((u) => u && String(u).trim())
      : [];

    const pushOne = (repoIndex) => {
      out.push({
        project_id: projectId,
        repo_index: repoIndex,
        base_branch: resolveBaseForRepo({
          projectId,
          repoIndex,
          project: proj,
          globalBase: baseBranch,
          repoBaseBranches,
          projectSelections,
        }),
        target_branch: target,
      });
    };

    if (repos.length === 0) {
      pushOne(0);
      continue;
    }
    for (let i = 0; i < repos.length; i += 1) {
      pushOne(i);
    }
  }
  return out;
}

/**
 * 创建任务表单门禁（与 CreateTaskModal createSubmitBlockedReason 对齐）
 * @returns {string} 空字符串表示可提交
 */
function validateCreateTaskForm(form = {}) {
  const title = String(form.title || '').trim();
  if (!title) return '请输入任务标题';
  const workspaceId = String(form.workspaceId || form.workspace_id || '').trim();
  if (!workspaceId) return '请选择工作空间';
  const owner = String(form.owner || '').trim();
  if (!owner) return '请填写 Owner';
  const projectIds = Array.isArray(form.projectIds)
    ? form.projectIds
    : (Array.isArray(form.projects) ? form.projects : []);
  if (!projectIds.length) return '请勾选至少一个项目';

  const source = normalizeFeatureParamsSource(form.feature_params_source);
  if (!source) return '请先选择环境变量参数后再创建';
  if (source === 'personal' && !String(form.personal_feature_params_config_id || '').trim()) {
    return '请先选择环境变量参数后再创建';
  }
  return '';
}

/**
 * 构建与 work-panel POST /todos/ 对齐的请求体
 */
function buildCreateTaskPayload(form = {}) {
  const workspaceId = String(form.workspaceId || form.workspace_id || '').trim();
  const workBranch = String(form.workBranch || form.work_branch_name || '').trim();
  const mergeTarget = String(form.mergeTarget || form.merge_target_branch_name || '').trim();
  const projectIds = Array.isArray(form.projectIds)
    ? form.projectIds.map(String)
    : [];

  const projects = Array.isArray(form.projects) && form.projects.length && !projectIds.length
    ? form.projects
    : buildProjectsFromSelection({
      projectIds,
      projectsList: form.projectsList || [],
      workBranch,
      baseBranch: form.baseBranch || '',
      repoBaseBranches: form.repoBaseBranches || {},
      projectSelections: form.projectSelections || [],
    });

  const payload = {
    title: String(form.title || '').trim(),
    description: String(form.description || ''),
    priority: normalizePriority(form.priority),
    workspace_id: workspaceId,
    owner: String(form.owner || '').trim(),
    assignees: normalizeAssignees(form.assignees),
    projects,
    due_date: String(form.due_date || '').trim() || getDefaultTaskDeadline(form.now || new Date()),
    auto_run: form.auto_run === true,
  };

  const progressColumnId = String(form.progress_column_id || form.progressColumnId || '').trim();
  if (progressColumnId) payload.progress_column_id = progressColumnId;

  const deliverableObjId = String(form.deliverable_obj_id || form.deliverableObjId || '').trim();
  if (deliverableObjId) payload.deliverable_obj_id = deliverableObjId;

  const containerImageId = String(form.container_image_id || form.containerImageId || '').trim();
  if (containerImageId) payload.container_image_id = containerImageId;

  if (form.force_auto_run === true) payload.force_auto_run = true;

  Object.assign(payload, buildFeatureParamsFields(form));

  if (workBranch || mergeTarget) {
    payload.branch_strategy = {
      work_branch_name: workBranch,
      merge_target_branch_name: mergeTarget,
      target_branch_name: workBranch,
    };
  } else if (form.branch_strategy && typeof form.branch_strategy === 'object') {
    payload.branch_strategy = { ...form.branch_strategy };
  }

  return payload;
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 勾选项目后的逐仓基准分支编辑区 HTML（纯函数，供 panel / content 复用）
 */
function buildRepoBaseEditorsHtml({
  projectIds = [],
  projectsList = [],
  previousValues = {},
  inputClass = 'form-input',
  emptyHint = '请先勾选项目',
} = {}) {
  const ids = (projectIds || []).map(String).filter(Boolean);
  if (!ids.length) {
    return `<p class="placeholder" style="color:#6c7086;font-size:11px;">${escapeAttr(emptyHint)}</p>`;
  }
  let html = '';
  for (const projectId of ids) {
    const proj = projectsList.find((p) => String(p.id || p._id) === projectId);
    const name = proj?.name || proj?.displayName || proj?.title || projectId;
    const repos = Array.isArray(proj?.git_repos)
      ? proj.git_repos.filter((u) => u && String(u).trim())
      : [];
    const fallback = (proj?.base_branch && String(proj.base_branch).trim())
      || (proj?.default_branch && String(proj.default_branch).trim())
      || 'main';
    html += `<div class="repo-base-project" style="margin:6px 0;padding:6px;border:1px solid #45475a;border-radius:6px">`;
    html += `<div style="font-size:11px;font-weight:600;margin-bottom:4px">${escapeAttr(name)}</div>`;
    const rows = repos.length ? repos : [''];
    rows.forEach((url, i) => {
      const key = repoBaseBranchKey(projectId, i);
      const prev = previousValues[key] != null ? String(previousValues[key]) : '';
      const label = shortenRepoLabel(url, i);
      html += `<div class="repo-base-row" style="margin:4px 0">`;
      html += `<label style="display:block;font-size:10px;color:#a6adc8;margin-bottom:2px">${escapeAttr(label)}</label>`;
      html += `<input type="text" class="${escapeAttr(inputClass)} repo-base-input" `
        + `data-repo-base="1" data-project-id="${escapeAttr(projectId)}" data-repo-index="${i}" `
        + `placeholder="${escapeAttr(fallback)}" value="${escapeAttr(prev)}">`;
      html += `</div>`;
    });
    html += `</div>`;
  }
  return html;
}

/**
 * 悬浮面板「描述重置」是否可点击：描述框有任意内容时可清空。
 * @param {unknown} description
 * @returns {boolean}
 */
function shouldEnableDescReset(description) {
  return String(description ?? '').length > 0;
}

/**
 * 从容器读取逐仓基准分支 map
 * @param {ParentNode} root
 */
function readRepoBaseBranchesFromRoot(root) {
  const map = {};
  if (!root || typeof root.querySelectorAll !== 'function') return map;
  root.querySelectorAll('[data-repo-base][data-project-id]').forEach((el) => {
    const projectId = el.getAttribute('data-project-id');
    const repoIndex = el.getAttribute('data-repo-index') || '0';
    const key = repoBaseBranchKey(projectId, repoIndex);
    map[key] = String(el.value || '').trim();
  });
  return map;
}

const CreateTaskPayload = {
  normalizePriority,
  getDefaultTaskDeadline,
  buildProjectsFromSelection,
  buildFeatureParamsFields,
  validateCreateTaskForm,
  buildCreateTaskPayload,
  normalizeFeatureParamsSource,
  repoBaseBranchKey,
  normalizeAssignees,
  shortenRepoLabel,
  resolveBaseForRepo,
  buildRepoBaseEditorsHtml,
  readRepoBaseBranchesFromRoot,
  shouldEnableDescReset,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CreateTaskPayload;
}
if (typeof globalThis !== 'undefined') {
  globalThis.CreateTaskPayload = CreateTaskPayload;
}
