'use strict';

/**
 * 工作空间项目列表：名称旁标注是否允许自动运行；单选后推导自动运行控件状态。
 *
 * 与工作面板 / 创建任务门禁一致：仅当 server_run_template.default_auto_run === true
 * 视为可自动运行。缺字段视为不可自动运行（安全默认）。
 */

function projectDisplayName(project) {
  const id = project && (project.id || project._id);
  const name = project && (project.name || project.displayName || project.title);
  return String(name || id || '').trim();
}

function projectAllowsAutoRun(project) {
  const tpl = project && project.server_run_template;
  if (!tpl || typeof tpl !== 'object' || Array.isArray(tpl)) return false;
  return tpl.default_auto_run === true;
}

function projectAutoRunBadgeText(project) {
  return projectAllowsAutoRun(project) ? '可自动运行' : '不可自动运行';
}

function formatProjectListLabel(project) {
  const name = projectDisplayName(project);
  const badge = projectAutoRunBadgeText(project);
  return name ? `${name}（${badge}）` : badge;
}

function escapeHtmlFallback(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function projectId(project) {
  if (!project || typeof project !== 'object') return '';
  const id = project.id || project._id;
  return id == null ? '' : String(id);
}

function findProjectById(projects, id) {
  const want = String(id || '');
  if (!want || !Array.isArray(projects)) return null;
  return projects.find((p) => projectId(p) === want) || null;
}

function pickSingleProjectId(preferredIds, availableIds) {
  const avail = new Set((Array.isArray(availableIds) ? availableIds : []).map((x) => String(x)));
  if (!avail.size) return '';
  const preferred = Array.isArray(preferredIds) ? preferredIds : [];
  for (const raw of preferred) {
    const id = String(raw || '');
    if (id && avail.has(id)) return id;
  }
  return '';
}

/**
 * 列表项 caption HTML（名称 + 徽章）。调用方负责转义函数。
 * @param {object} project
 * @param {(s: string) => string} [esc]
 * @returns {string}
 */
function renderProjectCheckboxCaptionHtml(project, esc) {
  const escape = typeof esc === 'function' ? esc : escapeHtmlFallback;
  const allowed = projectAllowsAutoRun(project);
  const name = projectDisplayName(project);
  const badge = projectAutoRunBadgeText(project);
  return `${escape(name)} <span class="taskplugin-project-auto-run" data-auto-run="${allowed ? 'true' : 'false'}">${escape(badge)}</span>`;
}

/**
 * 单选 radio 行 HTML。
 * @param {object} project
 * @param {{ name?: string, esc?: (s: string) => string }} [opts]
 * @returns {string}
 */
function renderProjectRadioHtml(project, opts) {
  const escape = typeof opts?.esc === 'function' ? opts.esc : escapeHtmlFallback;
  const groupName = escape(String(opts?.name || 'project'));
  const id = escape(projectId(project));
  return `<label><input type="radio" name="${groupName}" value="${id}" class="project-radio"> ${renderProjectCheckboxCaptionHtml(project, escape)}</label>`;
}

/**
 * @param {{ selectedProject?: object|null, checkedPreference?: boolean }} [opts]
 * @returns {{ enabled: boolean, checked: boolean, hint: string }}
 */
function resolveAutoRunControlState(opts) {
  const selectedProject = opts && opts.selectedProject;
  const checkedPreference = Boolean(opts && opts.checkedPreference);
  const id = projectId(selectedProject);
  if (!id) {
    return { enabled: false, checked: false, hint: '请先选择项目' };
  }
  if (!projectAllowsAutoRun(selectedProject)) {
    return {
      enabled: false,
      checked: false,
      hint: '当前项目未允许自动运行，请在项目设置中开启「是否允许自动运行」',
    };
  }
  return {
    enabled: true,
    checked: checkedPreference,
    hint: '创建后按项目运行模版启动云服务器',
  };
}

/**
 * @param {{ disabled?: boolean, checked?: boolean, setAttribute?: Function }|null} inputEl
 * @param {{ textContent?: string }|null} hintEl
 * @param {{ enabled?: boolean, checked?: boolean, hint?: string }} state
 */
function applyAutoRunControlToElements(inputEl, hintEl, state) {
  const enabled = Boolean(state && state.enabled);
  const checked = Boolean(state && state.checked);
  const hint = state && state.hint != null ? String(state.hint) : '';
  if (inputEl) {
    inputEl.disabled = !enabled;
    inputEl.checked = enabled ? checked : false;
    if (typeof inputEl.setAttribute === 'function') {
      inputEl.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    }
  }
  if (hintEl) hintEl.textContent = hint;
}

const ProjectAutoRunLabel = {
  projectDisplayName,
  projectAllowsAutoRun,
  projectAutoRunBadgeText,
  formatProjectListLabel,
  renderProjectCheckboxCaptionHtml,
  renderProjectRadioHtml,
  findProjectById,
  pickSingleProjectId,
  resolveAutoRunControlState,
  applyAutoRunControlToElements,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProjectAutoRunLabel;
}
if (typeof globalThis !== 'undefined') {
  globalThis.ProjectAutoRunLabel = ProjectAutoRunLabel;
}
