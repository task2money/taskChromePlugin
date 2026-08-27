'use strict';

/**
 * 工作空间项目列表：名称旁标注是否允许自动运行。
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

/**
 * 复选框 caption HTML（名称 + 徽章）。调用方负责转义函数。
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

const ProjectAutoRunLabel = {
  projectDisplayName,
  projectAllowsAutoRun,
  projectAutoRunBadgeText,
  formatProjectListLabel,
  renderProjectCheckboxCaptionHtml,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProjectAutoRunLabel;
}
if (typeof globalThis !== 'undefined') {
  globalThis.ProjectAutoRunLabel = ProjectAutoRunLabel;
}
