'use strict';

/**
 * 工作空间项目列表：名称旁标注是否允许自动运行；单选后推导自动运行控件状态。
 *
 * 与工作面板 / 创建任务门禁 / OPT-20260720-032 一致：读
 * server_run_template.allow_auto_run（新键，优先）或 default_auto_run（旧键），
 * 仅当对应值为 boolean true 视为可自动运行。缺字段视为不可自动运行（安全默认）。
 */

if (!globalThis.__taskpluginContentBoot?.skip) {
/** 门禁字段新名（与 taskFE AUTO_RUN_TEMPLATE_KEY / 项目 API 序列化一致）。 */
const AUTO_RUN_TEMPLATE_KEY = 'allow_auto_run';
/** 门禁字段旧名（仅读兼容）。 */
const AUTO_RUN_TEMPLATE_LEGACY_KEY = 'default_auto_run';

function projectDisplayName(project) {
  const id = project && (project.id || project._id);
  const name = project && (project.name || project.displayName || project.title);
  return String(name || id || '').trim();
}

/**
 * 双读 server_run_template 自动运行门禁：新键优先，缺省回退旧键。
 * 严格 === true（与历史插件契约一致；字符串/数字不视为允许）。
 */
function projectAllowsAutoRun(project) {
  const tpl = project && project.server_run_template;
  if (!tpl || typeof tpl !== 'object' || Array.isArray(tpl)) return false;
  if (tpl[AUTO_RUN_TEMPLATE_KEY] !== undefined) {
    return tpl[AUTO_RUN_TEMPLATE_KEY] === true;
  }
  return tpl[AUTO_RUN_TEMPLATE_LEGACY_KEY] === true;
}

function projectAutoRunBadgeText(project) {
  return projectAllowsAutoRun(project) ? tx('autoRunBadgeAllowed') : tx('autoRunBadgeDisallowed');
}

function formatProjectListLabel(project) {
  const name = projectDisplayName(project);
  const badge = projectAutoRunBadgeText(project);
  return name ? tx('autoRunProjectLabelWithBadge', { name, badge }) : badge;
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

function hasInstalledImageId(raw) {
  return String(raw || '').trim() !== '';
}

/**
 * 项目是否已配置运行硬件模版（与工作面板 projectRunTemplateUtils.js 的
 * projectHasConfiguredRunTemplate 语义对齐：模版至少含一个有意义的字段）。
 * 缺模版时后端会以 AUTO_RUN_RUN_TEMPLATE_REQUIRED 拒绝自动运行，
 * 插件须在提交前禁掉自动运行勾选（OPT-20260827-034）。
 */
function projectHasConfiguredRunTemplate(project) {
  const tpl = project && project.server_run_template;
  if (!tpl || typeof tpl !== 'object' || Array.isArray(tpl)) return false;
  return Object.keys(tpl).some((k) => {
    const v = tpl[k];
    if (v == null || v === '') return false;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
    return true;
  });
}

function validateAutoRunRequiresImage(autoRun, imageId) {
  if (autoRun !== true) return '';
  if (hasInstalledImageId(imageId)) return '';
  return tx('autoRunSelectImageRequired');
}

/**
 * @param {{ projectAllowsAutoRun?: boolean }} [opts]
 * @returns {{ requiredMarkVisible: boolean, requiredMarkText: string, emptyOptionLabel: string }}
 */
function resolveImageFieldAppearance(opts) {
  const requiredForAutoRun = Boolean(opts && opts.projectAllowsAutoRun);
  return {
    requiredMarkVisible: requiredForAutoRun,
    requiredMarkText: tx('autoRunRequiredMark'),
    emptyOptionLabel: requiredForAutoRun ? tx('autoRunSelectImagePlaceholder') : tx('autoRunNone'),
  };
}

/**
 * @param {{ hidden?: boolean, textContent?: string }|null} markEl
 * @param {{ setAttribute?: Function, querySelector?: Function }|null} selectEl
 * @param {{ requiredMarkVisible?: boolean, requiredMarkText?: string, emptyOptionLabel?: string }} appearance
 */
function applyImageFieldAppearance(markEl, selectEl, appearance) {
  const visible = Boolean(appearance && appearance.requiredMarkVisible);
  const markText = appearance && appearance.requiredMarkText != null
    ? String(appearance.requiredMarkText)
    : tx('autoRunRequiredMark');
  const emptyLabel = appearance && appearance.emptyOptionLabel != null
    ? String(appearance.emptyOptionLabel)
    : (visible ? tx('autoRunSelectImagePlaceholder') : tx('autoRunNone'));
  if (markEl) {
    markEl.hidden = !visible;
    markEl.textContent = markText;
  }
  if (selectEl && typeof selectEl.setAttribute === 'function') {
    selectEl.setAttribute('aria-required', visible ? 'true' : 'false');
    if (typeof selectEl.querySelector === 'function') {
      const empty = selectEl.querySelector('option[value=""]');
      if (empty) empty.textContent = emptyLabel;
    }
  }
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
 * 提示文案只返回消息键，由渲染方经 i18n 取词（ADR-0089）——
 * 本模块须保持零 DOM / 零 i18n 依赖，便于纯 Node 单测。
 * @param {{
 *   selectedProject?: object|null,
 *   checkedPreference?: boolean,
 *   hasInstalledImage?: boolean,
 * }} [opts]
 * @returns {{ enabled: boolean, checked: boolean, hintKey: string }}
 */
function resolveAutoRunControlState(opts) {
  const selectedProject = opts && opts.selectedProject;
  const checkedPreference = Boolean(opts && opts.checkedPreference);
  const hasInstalledImage = Boolean(opts && opts.hasInstalledImage);
  const id = projectId(selectedProject);
  if (!id) {
    return { enabled: false, checked: false, hintKey: 'panelAutoRunHintPickProject' };
  }
  if (!projectAllowsAutoRun(selectedProject)) {
    return {
      enabled: false,
      checked: false,
      hintKey: 'panelAutoRunHintNotAllowed',
    };
  }
  if (!hasInstalledImage) {
    return { enabled: false, checked: false, hintKey: 'panelAutoRunHintPickImage' };
  }
  if (!projectHasConfiguredRunTemplate(selectedProject)) {
    return {
      enabled: false,
      checked: false,
      hintKey: 'panelAutoRunHintNoTemplate',
    };
  }
  return {
    enabled: true,
    checked: checkedPreference,
    hintKey: 'panelAutoRunHintReady',
  };
}

/**
 * @param {{ disabled?: boolean, checked?: boolean, setAttribute?: Function }|null} inputEl
 * @param {{ textContent?: string }|null} hintEl
 * @param {{ enabled?: boolean, checked?: boolean, hintKey?: string }} state
 * @param {{ t?: (key: string) => string }} [opts] 取词函数（缺省回退为键本身）
 */
function applyAutoRunControlToElements(inputEl, hintEl, state, opts) {
  const enabled = Boolean(state && state.enabled);
  const checked = Boolean(state && state.checked);
  const key = state && state.hintKey != null ? String(state.hintKey) : '';
  const t = opts && typeof opts.t === 'function' ? opts.t : null;
  const hint = key ? (t ? t(key) : key) : '';
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
  hasInstalledImageId,
  projectHasConfiguredRunTemplate,
  validateAutoRunRequiresImage,
  resolveImageFieldAppearance,
  applyImageFieldAppearance,
  resolveAutoRunControlState,
  applyAutoRunControlToElements,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProjectAutoRunLabel;
}
if (typeof globalThis !== 'undefined') {
  globalThis.ProjectAutoRunLabel = ProjectAutoRunLabel;
}
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    projectDisplayName, projectAllowsAutoRun, projectAutoRunBadgeText,
    formatProjectListLabel, escapeHtmlFallback, projectId, findProjectById,
    pickSingleProjectId, hasInstalledImageId,
    projectHasConfiguredRunTemplate, validateAutoRunRequiresImage,
    resolveImageFieldAppearance, applyImageFieldAppearance,
    renderProjectCheckboxCaptionHtml, renderProjectRadioHtml,
    resolveAutoRunControlState, applyAutoRunControlToElements,
  });
}
}
