/**
 * Alt+Shift+E：元素点选后自动创新（交互对齐 Alt+X，非拖拽矩形）。
 * 须在 float-pick / float-page-advisor 附近注入；顶层绑定挂 globalThis。
 */

'use strict';

var pendingPageAdvisorRegion = null;
var pendingPageAdvisorElements = null;
var pageAdvisorRegionMode = false;
var pageAdvisorPickSelection = [];
var pageAdvisorPickFrame = null;
var pageAdvisorLastRegion = null;

function unionPageAdvisorElementRects(els) {
  const list = Array.isArray(els) ? els : [];
  const Region = typeof PageAdvisorRegion !== 'undefined' ? PageAdvisorRegion : null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of list) {
    if (!el || typeof el.getBoundingClientRect !== 'function') continue;
    let r;
    try {
      r = el.getBoundingClientRect();
    } catch (_) {
      continue;
    }
    left = Math.min(left, Number(r.left) || 0);
    top = Math.min(top, Number(r.top) || 0);
    right = Math.max(right, Number(r.right) || 0);
    bottom = Math.max(bottom, Number(r.bottom) || 0);
  }
  if (!Number.isFinite(left)) return null;
  const region = {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
  if (Region && Region.isValidRegion && !Region.isValidRegion(region)) return null;
  return region;
}

function rememberPageAdvisorLastRegion(region) {
  if (!region) return;
  pageAdvisorLastRegion = {
    left: Number(region.left) || 0,
    top: Number(region.top) || 0,
    width: Number(region.width) || 0,
    height: Number(region.height) || 0,
  };
}

function getPageAdvisorLastRegion() {
  return pageAdvisorLastRegion
    ? {
      left: pageAdvisorLastRegion.left,
      top: pageAdvisorLastRegion.top,
      width: pageAdvisorLastRegion.width,
      height: pageAdvisorLastRegion.height,
    }
    : null;
}

function clearPageAdvisorLastRegion() {
  pageAdvisorLastRegion = null;
}

/** 重试前恢复上次区域采集范围（矩形 / 元素点选并集） */
function restorePageAdvisorLastCaptureForRetry() {
  const last = getPageAdvisorLastRegion();
  if (!last) return false;
  setPendingPageAdvisorRegion(last);
  clearPendingPageAdvisorElements();
  return true;
}

function getPendingPageAdvisorRegion() {
  return pendingPageAdvisorRegion;
}

function clearPendingPageAdvisorRegion() {
  pendingPageAdvisorRegion = null;
}

function setPendingPageAdvisorRegion(region) {
  pendingPageAdvisorRegion = region || null;
}

function getPendingPageAdvisorElements() {
  return pendingPageAdvisorElements;
}

function clearPendingPageAdvisorElements() {
  pendingPageAdvisorElements = null;
}

function setPendingPageAdvisorElements(els) {
  pendingPageAdvisorElements = Array.isArray(els) ? els.filter((el) => el && el.nodeType === 1) : null;
}

function isPageAdvisorRegionMode() {
  return pageAdvisorRegionMode === true;
}

function ensureRegionSelectHint() {
  let hint = document.getElementById('taskplugin-region-select-hint');
  if (hint) return hint;
  hint = document.createElement('div');
  hint.id = 'taskplugin-region-select-hint';
  hint.className = 'taskplugin-region-select-hint';
  hint.setAttribute('role', 'status');
  hint.textContent = '点击页面元素后自动创新 · ⌘/Ctrl 多选后 Enter · Esc 取消';
  const host = document.body || document.documentElement;
  if (host) host.appendChild(hint);
  return hint;
}

function setRegionSelectHintText(text) {
  const hint = ensureRegionSelectHint();
  if (hint) hint.textContent = text;
}

function clearAdvisorPickSelection() {
  pageAdvisorPickSelection = [];
  pageAdvisorPickFrame = null;
}

function detachRegionSelectListeners() {
  document.removeEventListener('mouseover', onRegionSelectMouseOver, true);
  document.removeEventListener('click', onRegionSelectClick, true);
  document.removeEventListener('keydown', onRegionSelectKeyDown, true);
}

/**
 * 区域点选开始前收起「快速创建任务」浮窗。
 * 统一委托 layer 的 collapseFloatPanelDuringAdvisor，避免两处收起逻辑漂移
 * （layer 侧含 FAB 文案复位，region 侧此前遗漏）。
 */
function closeFloatPanelForRegionSelect() {
  collapseFloatPanelDuringAdvisor();
}

function stopPageAdvisorRegionSelect(opts = {}) {
  pageAdvisorRegionMode = false;
  clearAdvisorPickSelection();
  detachRegionSelectListeners();
  try {
    document.documentElement.classList.remove('taskplugin-region-selecting');
  } catch (_) { /* ignore */ }
  if (typeof clearHighlight === 'function') clearHighlight();
  const hint = document.getElementById('taskplugin-region-select-hint');
  if (hint) {
    if (opts.remove) hint.remove();
    else hint.hidden = true;
  }
  // 清理遗留矩形 overlay（旧版）
  const overlay = document.getElementById('taskplugin-region-select-overlay');
  if (overlay) overlay.remove();
  if (typeof btn !== 'undefined' && btn && typeof pickMode !== 'undefined' && !pickMode) {
    btn.textContent = '+';
    btn.classList.remove('taskplugin-picking-fab');
    if (typeof renderShortcutHints === 'function') renderShortcutHints();
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
  clearPendingPageAdvisorElements();
  clearAdvisorPickSelection();
  closeFloatPanelForRegionSelect();
  pageAdvisorRegionMode = true;
  try {
    document.documentElement.classList.add('taskplugin-region-selecting');
  } catch (_) { /* ignore */ }
  const hint = ensureRegionSelectHint();
  hint.hidden = false;
  setRegionSelectHintText('点击页面元素后自动创新 · ⌘/Ctrl 多选后 Enter · Esc 取消');
  if (typeof btn !== 'undefined' && btn) {
    btn.textContent = '✕';
    btn.classList.add('taskplugin-picking-fab');
    btn.title = '退出元素选择（或按 Esc）';
  }
  if (typeof ensureHighlightStyle === 'function') ensureHighlightStyle(document);
  document.addEventListener('mouseover', onRegionSelectMouseOver, true);
  document.addEventListener('click', onRegionSelectClick, true);
  document.addEventListener('keydown', onRegionSelectKeyDown, true);
  if (typeof showPageToast === 'function') {
    showPageToast('请点击要创新的页面元素（Esc 取消）');
  }
  return { success: true, active: true };
}

function onRegionSelectMouseOver(e) {
  if (!pageAdvisorRegionMode) return;
  if (typeof resolvePickTarget !== 'function' || typeof applyHighlightMany !== 'function') return;
  const { el, crossOrigin } = resolvePickTarget(e);
  if (crossOrigin || !el || (typeof isPluginDom === 'function' && isPluginDom(el))) {
    if (pageAdvisorPickSelection.length) {
      applyHighlightMany(pageAdvisorPickSelection, pageAdvisorPickSelection[0].ownerDocument);
    } else if (typeof clearHighlight === 'function') {
      clearHighlight();
    }
    return;
  }
  const hoverSet = pageAdvisorPickSelection.includes(el)
    ? pageAdvisorPickSelection
    : pageAdvisorPickSelection.concat([el]);
  applyHighlightMany(hoverSet, el.ownerDocument);
}

function confirmAdvisorElements(els) {
  const list = (Array.isArray(els) ? els : [els]).filter((el) => el && el.nodeType === 1);
  if (!list.length) return;
  setPendingPageAdvisorElements(list);
  clearPendingPageAdvisorRegion();
  const union = unionPageAdvisorElementRects(list);
  if (union) rememberPageAdvisorLastRegion(union);
  stopPageAdvisorRegionSelect();
  try {
    chrome.runtime.sendMessage({ action: 'pageOptimizationSuggest' }, () => {
      void chrome.runtime.lastError;
    });
  } catch (err) {
    clearPendingPageAdvisorElements();
    if (typeof showPageToast === 'function') {
      showPageToast(err?.message || '启动区域创新失败');
    }
  }
}

function onRegionSelectClick(e) {
  if (!pageAdvisorRegionMode) return;
  if (e.button !== 0) return;
  const t = e.target;
  if (t && typeof t.closest === 'function' && t.closest('#taskplugin-float-btn')) {
    e.preventDefault();
    e.stopPropagation();
    stopPageAdvisorRegionSelect();
    if (typeof showPageToast === 'function') showPageToast('已取消元素选择');
    return;
  }
  if (typeof resolvePickTarget !== 'function') return;
  const { el, frameElement, crossOrigin } = resolvePickTarget(e);
  if (crossOrigin) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof showPageToast === 'function') {
      showPageToast('跨域 iframe 请在顶层页面选择元素');
    }
    return;
  }
  if (!el || (typeof isPluginDom === 'function' && isPluginDom(el))) return;

  e.preventDefault();
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

  const meta = !!(e.metaKey || e.ctrlKey);
  if (meta) {
    if (
      pageAdvisorPickSelection.length > 0
      && pageAdvisorPickFrame !== (frameElement || null)
    ) {
      if (typeof showPageToast === 'function') {
        showPageToast('多选仅限同一 frame');
      }
      return;
    }
    if (pageAdvisorPickSelection.length === 0) {
      pageAdvisorPickFrame = frameElement || null;
    }
    if (typeof ElementPicker !== 'undefined' && ElementPicker.toggleDisjointSelection) {
      pageAdvisorPickSelection = ElementPicker.toggleDisjointSelection(
        pageAdvisorPickSelection,
        el,
      );
    } else if (pageAdvisorPickSelection.includes(el)) {
      pageAdvisorPickSelection = pageAdvisorPickSelection.filter((x) => x !== el);
    } else {
      pageAdvisorPickSelection = pageAdvisorPickSelection.concat([el]);
    }
    if (pageAdvisorPickSelection.length === 0) pageAdvisorPickFrame = null;
    if (typeof applyHighlightMany === 'function') {
      applyHighlightMany(
        pageAdvisorPickSelection.length ? pageAdvisorPickSelection : [el],
        el.ownerDocument,
      );
    }
    const n = pageAdvisorPickSelection.length;
    setRegionSelectHintText(
      n
        ? `已选 ${n} 个：Enter 确认；⌘/Ctrl+点击继续 · Esc 清空`
        : '已清空：⌘/Ctrl+点击添加，或普通点击单选',
    );
    return;
  }

  clearAdvisorPickSelection();
  confirmAdvisorElements([el]);
}

function onRegionSelectKeyDown(e) {
  if (!pageAdvisorRegionMode) return;
  if (e.key === 'Enter') {
    if (pageAdvisorPickSelection.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    confirmAdvisorElements(pageAdvisorPickSelection.slice());
    return;
  }
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  if (pageAdvisorPickSelection.length > 0) {
    clearAdvisorPickSelection();
    if (typeof clearHighlight === 'function') clearHighlight();
    setRegionSelectHintText('已清空多选；再按 Esc 退出 · 或点击元素');
    return;
  }
  stopPageAdvisorRegionSelect();
  if (typeof showPageToast === 'function') showPageToast('已取消元素选择');
}

if (typeof globalThis !== 'undefined') {
  globalThis.getPendingPageAdvisorRegion = getPendingPageAdvisorRegion;
  globalThis.clearPendingPageAdvisorRegion = clearPendingPageAdvisorRegion;
  globalThis.getPendingPageAdvisorElements = getPendingPageAdvisorElements;
  globalThis.clearPendingPageAdvisorElements = clearPendingPageAdvisorElements;
  globalThis.getPageAdvisorLastRegion = getPageAdvisorLastRegion;
  globalThis.clearPageAdvisorLastRegion = clearPageAdvisorLastRegion;
  globalThis.restorePageAdvisorLastCaptureForRetry = restorePageAdvisorLastCaptureForRetry;
  globalThis.startPageAdvisorRegionSelect = startPageAdvisorRegionSelect;
  globalThis.stopPageAdvisorRegionSelect = stopPageAdvisorRegionSelect;
  globalThis.isPageAdvisorRegionMode = isPageAdvisorRegionMode;
  globalThis.triggerPageAdvisorFromShortcut = triggerPageAdvisorFromShortcut;
  globalThis.triggerPageAdvisorRegionFromShortcut = triggerPageAdvisorRegionFromShortcut;
}

/** 页内兜底：Alt+Z → 全页优化建议（与 chrome.commands 去抖） */
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

/** 页内兜底：Alt+Shift+Z → 元素点选后创新 */
function triggerPageAdvisorRegionFromShortcut() {
  const now = Date.now();
  if (typeof lastShortcutToggleAt !== 'undefined' && typeof SHORTCUT_DEBOUNCE_MS !== 'undefined') {
    if (now - lastShortcutToggleAt < SHORTCUT_DEBOUNCE_MS) return;
    lastShortcutToggleAt = now;
  }
  startPageAdvisorRegionSelect();
}
