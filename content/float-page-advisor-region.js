/**
 * Alt+Shift+E 区域框选 overlay（须在 float-page-advisor 之前/附近注入）。
 * 顶层绑定挂 globalThis，避免 content_scripts 词法冲突。
 */

'use strict';

var pendingPageAdvisorRegion = null;
var pageAdvisorRegionMode = false;
var pageAdvisorRegionDrag = null;

function getPendingPageAdvisorRegion() {
  return pendingPageAdvisorRegion;
}

function clearPendingPageAdvisorRegion() {
  pendingPageAdvisorRegion = null;
}

function setPendingPageAdvisorRegion(region) {
  pendingPageAdvisorRegion = region || null;
}

function isPageAdvisorRegionMode() {
  return pageAdvisorRegionMode === true;
}

function ensureRegionSelectOverlay() {
  let overlay = document.getElementById('taskplugin-region-select-overlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'taskplugin-region-select-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', '框选页面区域以生成优化建议');
  overlay.innerHTML = `
    <div class="taskplugin-region-select-hint" id="taskplugin-region-select-hint">
      拖拽框选区域后自动创新 · Esc 取消
    </div>
    <div class="taskplugin-region-select-box" id="taskplugin-region-select-box" hidden></div>
  `;
  const host = (typeof root !== 'undefined' && root) ? root : document.documentElement;
  host.appendChild(overlay);
  return overlay;
}

function updateRegionSelectBox(rect) {
  const box = document.getElementById('taskplugin-region-select-box');
  if (!box || !rect) return;
  box.hidden = false;
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${Math.max(0, rect.width)}px`;
  box.style.height = `${Math.max(0, rect.height)}px`;
}

function detachRegionSelectListeners() {
  document.removeEventListener('mousedown', onRegionSelectMouseDown, true);
  document.removeEventListener('mousemove', onRegionSelectMouseMove, true);
  document.removeEventListener('mouseup', onRegionSelectMouseUp, true);
  document.removeEventListener('keydown', onRegionSelectKeyDown, true);
}

function stopPageAdvisorRegionSelect(opts = {}) {
  pageAdvisorRegionMode = false;
  pageAdvisorRegionDrag = null;
  detachRegionSelectListeners();
  const overlay = document.getElementById('taskplugin-region-select-overlay');
  if (overlay) {
    if (opts.remove) overlay.remove();
    else overlay.hidden = true;
  }
}

function startPageAdvisorRegionSelect() {
  if (pageAdvisorRegionMode) {
    stopPageAdvisorRegionSelect({ remove: false });
    return { success: true, active: false };
  }
  if (typeof pickMode !== 'undefined' && pickMode && typeof setPickMode === 'function') {
    setPickMode(false);
  }
  clearPendingPageAdvisorRegion();
  pageAdvisorRegionMode = true;
  const overlay = ensureRegionSelectOverlay();
  overlay.hidden = false;
  const box = document.getElementById('taskplugin-region-select-box');
  if (box) box.hidden = true;
  const hint = document.getElementById('taskplugin-region-select-hint');
  if (hint) hint.textContent = '拖拽框选区域后自动创新 · Esc 取消';
  document.addEventListener('mousedown', onRegionSelectMouseDown, true);
  document.addEventListener('mousemove', onRegionSelectMouseMove, true);
  document.addEventListener('mouseup', onRegionSelectMouseUp, true);
  document.addEventListener('keydown', onRegionSelectKeyDown, true);
  if (typeof showPageToast === 'function') {
    showPageToast('请拖拽框选要创新的区域（Esc 取消）');
  }
  return { success: true, active: true };
}

function onRegionSelectKeyDown(e) {
  if (!pageAdvisorRegionMode) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    stopPageAdvisorRegionSelect();
    if (typeof showPageToast === 'function') showPageToast('已取消区域框选');
  }
}

function onRegionSelectMouseDown(e) {
  if (!pageAdvisorRegionMode) return;
  if (e.button !== 0) return;
  const t = e.target;
  if (t && typeof t.closest === 'function' && t.closest('#taskplugin-float-btn')) return;
  e.preventDefault();
  e.stopPropagation();
  pageAdvisorRegionDrag = { x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY };
  const Region = typeof PageAdvisorRegion !== 'undefined' ? PageAdvisorRegion : null;
  const rect = Region
    ? Region.normalizeRect(pageAdvisorRegionDrag)
    : { left: e.clientX, top: e.clientY, width: 0, height: 0 };
  updateRegionSelectBox(rect);
}

function onRegionSelectMouseMove(e) {
  if (!pageAdvisorRegionMode || !pageAdvisorRegionDrag) return;
  e.preventDefault();
  pageAdvisorRegionDrag.x2 = e.clientX;
  pageAdvisorRegionDrag.y2 = e.clientY;
  const Region = typeof PageAdvisorRegion !== 'undefined' ? PageAdvisorRegion : null;
  const rect = Region
    ? Region.normalizeRect(pageAdvisorRegionDrag)
    : {
      left: Math.min(pageAdvisorRegionDrag.x1, pageAdvisorRegionDrag.x2),
      top: Math.min(pageAdvisorRegionDrag.y1, pageAdvisorRegionDrag.y2),
      width: Math.abs(pageAdvisorRegionDrag.x2 - pageAdvisorRegionDrag.x1),
      height: Math.abs(pageAdvisorRegionDrag.y2 - pageAdvisorRegionDrag.y1),
    };
  updateRegionSelectBox(rect);
}

function onRegionSelectMouseUp(e) {
  if (!pageAdvisorRegionMode || !pageAdvisorRegionDrag) return;
  e.preventDefault();
  e.stopPropagation();
  const Region = typeof PageAdvisorRegion !== 'undefined' ? PageAdvisorRegion : null;
  const corners = pageAdvisorRegionDrag;
  pageAdvisorRegionDrag = null;
  const rect = Region
    ? Region.normalizeRect(corners)
    : {
      left: Math.min(corners.x1, corners.x2),
      top: Math.min(corners.y1, corners.y2),
      width: Math.abs(corners.x2 - corners.x1),
      height: Math.abs(corners.y2 - corners.y1),
    };
  if (!Region || !Region.isValidRegion(rect)) {
    const hint = document.getElementById('taskplugin-region-select-hint');
    if (hint) hint.textContent = '选区过小，请重新拖拽 · Esc 取消';
    if (typeof showPageToast === 'function') showPageToast('选区过小，请重新框选');
    const box = document.getElementById('taskplugin-region-select-box');
    if (box) box.hidden = true;
    return;
  }
  setPendingPageAdvisorRegion(rect);
  stopPageAdvisorRegionSelect();
  try {
    chrome.runtime.sendMessage({ action: 'pageOptimizationSuggest' }, () => {
      void chrome.runtime.lastError;
    });
  } catch (err) {
    clearPendingPageAdvisorRegion();
    if (typeof showPageToast === 'function') {
      showPageToast(err?.message || '启动区域创新失败');
    }
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.getPendingPageAdvisorRegion = getPendingPageAdvisorRegion;
  globalThis.clearPendingPageAdvisorRegion = clearPendingPageAdvisorRegion;
  globalThis.startPageAdvisorRegionSelect = startPageAdvisorRegionSelect;
  globalThis.stopPageAdvisorRegionSelect = stopPageAdvisorRegionSelect;
  globalThis.isPageAdvisorRegionMode = isPageAdvisorRegionMode;
  globalThis.triggerPageAdvisorFromShortcut = triggerPageAdvisorFromShortcut;
  globalThis.triggerPageAdvisorRegionFromShortcut = triggerPageAdvisorRegionFromShortcut;
}

/** 页内兜底：Alt+E → 全页优化建议（与 chrome.commands 去抖） */
function triggerPageAdvisorFromShortcut() {
  const now = Date.now();
  if (typeof lastShortcutToggleAt !== 'undefined' && typeof SHORTCUT_DEBOUNCE_MS !== 'undefined') {
    if (now - lastShortcutToggleAt < SHORTCUT_DEBOUNCE_MS) return;
    lastShortcutToggleAt = now;
  }
  try {
    chrome.runtime.sendMessage({ action: 'pageOptimizationSuggest' }, () => {
      void chrome.runtime.lastError;
    });
  } catch (_) { /* ignore */ }
}

/** 页内兜底：Alt+Shift+E → 区域框选后创新 */
function triggerPageAdvisorRegionFromShortcut() {
  const now = Date.now();
  if (typeof lastShortcutToggleAt !== 'undefined' && typeof SHORTCUT_DEBOUNCE_MS !== 'undefined') {
    if (now - lastShortcutToggleAt < SHORTCUT_DEBOUNCE_MS) return;
    lastShortcutToggleAt = now;
  }
  startPageAdvisorRegionSelect();
}
