'use strict';

/**
 * DevTools 单请求创建收尾：成功则先清空再提示；失败则只提示、不清空。
 * 纯函数，无 Chrome API。
 */

function extractCreatedTaskId(data) {
  if (!data || typeof data !== 'object') return '(已创建)';
  const id = data.id ?? data._id;
  if (id == null || id === '') return '(已创建)';
  return String(id);
}

function formatCreateSuccessMessage(taskId) {
  const id = taskId == null || taskId === '' ? '(已创建)' : String(taskId);
  return `✅ 任务创建成功! ID: ${id}`;
}

function formatCreateFailureMessage(reason) {
  const text = reason == null ? '' : String(reason);
  return `❌ 创建失败: ${text}`;
}

function el(root, id) {
  if (!root || typeof root.getElementById !== 'function') return null;
  return root.getElementById(id);
}

function setValue(root, id, value) {
  const node = el(root, id);
  if (node && 'value' in node) node.value = value;
}

function setChecked(root, id, checked) {
  const node = el(root, id);
  if (node && 'checked' in node) node.checked = Boolean(checked);
}

function setHidden(root, id, hidden) {
  const node = el(root, id);
  if (node) node.hidden = Boolean(hidden);
}

function uncheckAll(root, selector) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const list = root.querySelectorAll(selector);
  for (const node of list) {
    if (node && 'checked' in node) node.checked = false;
  }
}

/**
 * 清空本次创建填写的选项；不改工作空间/负责人/进度列，也不写成功文案。
 * @param {ParentNode} root
 * @param {{ emptyHint: string, defaultDueDate: string, defaultPriority?: string }} opts
 */
function resetSingleCreateFields(root, opts) {
  if (!opts || typeof opts.emptyHint !== 'string' || typeof opts.defaultDueDate !== 'string') {
    throw new Error('resetSingleCreateFields requires emptyHint and defaultDueDate');
  }
  setValue(root, 'singleTaskTitle', '');
  setValue(root, 'singleTaskDesc', '');
  setValue(root, 'singleWorkBranch', '');
  setValue(root, 'singleMergeTarget', '');
  setValue(root, 'singleDeliverable', '');
  setValue(root, 'singleContainerImage', '');
  setValue(root, 'singleFeatureParamsSource', '');
  setValue(root, 'singlePersonalConfig', '');
  setValue(root, 'singleDueDate', opts.defaultDueDate);
  setValue(root, 'singlePriority', opts.defaultPriority || '1');
  setHidden(root, 'singlePersonalConfigWrap', true);
  setChecked(root, 'singleAutoRun', false);
  setChecked(root, 'singleQueuedAutoRun', false);
  setHidden(root, 'singleQueuedAutoRunWrap', true);
  const queueErr = el(root, 'singleQueuedAutoRunError');
  if (queueErr) {
    queueErr.hidden = true;
    queueErr.textContent = '';
    queueErr.className = 'result';
  }
  const bases = el(root, 'singleRepoBases');
  if (bases) {
    bases.innerHTML = `<p class="placeholder">${opts.emptyHint}</p>`;
  }
  const gitIds = el(root, 'singleGitIdentities');
  if (gitIds) gitIds.innerHTML = '';
  uncheckAll(root, '#singleProjects input.project-radio');
  uncheckAll(root, '#singleAssignees .assignee-check');
}

/**
 * 成功收尾顺序：先 reset，再 showSuccess。
 * @param {{ reset: Function, showSuccess: Function, message: string }} steps
 */
function runAfterSuccess(steps) {
  if (!steps || typeof steps.reset !== 'function') {
    throw new Error('runAfterSuccess requires reset()');
  }
  if (typeof steps.showSuccess !== 'function') {
    throw new Error('runAfterSuccess requires showSuccess()');
  }
  steps.reset();
  steps.showSuccess(steps.message);
}

/**
 * 失败收尾：只提示错误。传入 reset 即视为误用。
 * @param {{ showError: Function, message: string, traceId?: string, reset?: Function }} steps
 */
function runAfterFailure(steps) {
  if (!steps || typeof steps.showError !== 'function') {
    throw new Error('runAfterFailure requires showError()');
  }
  if (typeof steps.reset === 'function') {
    throw new Error('runAfterFailure must not reset the form');
  }
  steps.showError(steps.message, steps.traceId);
}

const PanelCreateSuccess = {
  extractCreatedTaskId,
  formatCreateSuccessMessage,
  formatCreateFailureMessage,
  resetSingleCreateFields,
  runAfterSuccess,
  runAfterFailure,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PanelCreateSuccess;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PanelCreateSuccess = PanelCreateSuccess;
}
