'use strict';

/**
 * 工作空间自动调度启用判定 + 创建任务「加入自动调度队列」可见性。
 * 对齐 taskFE createTaskQueuedAutoRun.js / workspaceAutoScheduleEnabled.js。
 */

function isWorkspaceAutoScheduleEnabled(snapshot) {
  return snapshot != null
    && typeof snapshot === 'object'
    && snapshot.schedule_rhythm != null
    && snapshot.schedule_rhythm.enabled === true;
}

function shouldShowCreateTaskQueuedAutoRun({
  canEnableAutoRun = false,
  autoRun = false,
  workspaceScheduleEnabled = false,
} = {}) {
  return Boolean(canEnableAutoRun && autoRun && workspaceScheduleEnabled);
}

function resolveQueuedAutoRunHint() {
  return '工作空间已启用自动调度。勾选后任务进入排队，按调度时段逐个启动，创建后不立即启服。不勾选则仍立即按运行模版启动。';
}

function appendQueuedAutoRunToCreatePayload(payload, task) {
  const out = payload && typeof payload === 'object' ? payload : {};
  if (task?.auto_run !== true) return out;
  out.queued_auto_run = task.queued_auto_run === true;
  return out;
}

function applyCreateTaskQueuedVisibility({ wrapEl, inputEl, show } = {}) {
  if (!wrapEl) return;
  const visible = Boolean(show);
  wrapEl.hidden = !visible;
  if (!visible && inputEl) inputEl.checked = false;
}

function setResultErrorClass(errorEl, on) {
  if (!errorEl) return;
  const parts = String(errorEl.className || '').split(/\s+/).filter(Boolean)
    .filter((c) => c !== 'error');
  if (on) parts.push('error');
  errorEl.className = parts.join(' ');
}

function clearFetchError(errorEl) {
  if (!errorEl) return;
  errorEl.hidden = true;
  errorEl.textContent = '';
  setResultErrorClass(errorEl, false);
  if (typeof setDataTraceId === 'function') {
    setDataTraceId(errorEl, '');
  } else if (typeof errorEl.removeAttribute === 'function') {
    errorEl.removeAttribute('data-traceId');
  }
}

function showFetchError(errorEl, err) {
  if (!errorEl) return;
  const message = err && err.message ? String(err.message) : '无法读取工作空间自动调度';
  errorEl.hidden = false;
  errorEl.textContent = message;
  setResultErrorClass(errorEl, true);
  const tid = err && err.traceId ? String(err.traceId) : '';
  if (typeof setDataTraceId === 'function') {
    setDataTraceId(errorEl, tid);
  } else if (tid) {
    errorEl.setAttribute('data-traceId', tid);
  } else if (typeof errorEl.removeAttribute === 'function') {
    errorEl.removeAttribute('data-traceId');
  }
}

const WorkspaceAutoSchedule = {
  isWorkspaceAutoScheduleEnabled,
  shouldShowCreateTaskQueuedAutoRun,
  resolveQueuedAutoRunHint,
  appendQueuedAutoRunToCreatePayload,
  applyCreateTaskQueuedVisibility,
  clearFetchError,
  showFetchError,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkspaceAutoSchedule;
}
if (typeof globalThis !== 'undefined') {
  globalThis.WorkspaceAutoSchedule = WorkspaceAutoSchedule;
}
