/**
 * Alt+E 建议层：焦点陷阱、DOM 预览 watcher（从 float-page-advisor.js 抽出以满足行数门禁）。
 */

'use strict';

var pageAdvisorDomWatcher = null;

function isPageAdvisorLayerVisible() {
  const layer = document.getElementById('taskplugin-page-advisor-layer');
  return !!(layer && !layer.hidden);
}

function isPageAdvisorSuggestionSelected(id) {
  const sid = String(id || '').replace(/"/g, '\\"');
  const check = document.querySelector(
    `#taskplugin-page-advisor-cards .taskplugin-page-advisor-check[value="${sid}"]`,
  );
  return !!(check && check.checked);
}

function stopPageAdvisorDomWatcher() {
  if (pageAdvisorDomWatcher) {
    pageAdvisorDomWatcher.stop();
    pageAdvisorDomWatcher = null;
  }
}

function startPageAdvisorDomWatcher() {
  stopPageAdvisorDomWatcher();
  const Preview = typeof PageAdvisorPreview !== 'undefined' ? PageAdvisorPreview : null;
  const session = typeof getPageAdvisorPreviewSession === 'function'
    ? getPageAdvisorPreviewSession()
    : null;
  if (!Preview?.createPreviewDomWatcher || !session) return;
  pageAdvisorDomWatcher = Preview.createPreviewDomWatcher({
    document,
    session,
    getSuggestions: () => pageAdvisorState.suggestions,
    resolveNid: (nid) => {
      const nidId = String(nid || '').replace(/"/g, '');
      return document.querySelector(`[data-taskplugin-nid="${nidId}"]`);
    },
    isSelected: (sid) => isPageAdvisorSuggestionSelected(sid),
    debounceMs: 80,
  });
  pageAdvisorDomWatcher.start();
}

function syncPageAdvisorFocusTrap() {
  const Trap = typeof DialogFocusTrap !== 'undefined' ? DialogFocusTrap : null;
  const layer = document.getElementById('taskplugin-page-advisor-layer');
  if (!Trap || !layer || layer.hidden) return;
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', '页面优化建议');
  const returnEl = (typeof btn !== 'undefined' && btn) ? btn : null;
  Trap.activateFocusTrap(layer, {
    returnFocusEl: returnEl,
    onEscape: () => {
      if (typeof closePageAdvisorModal === 'function') closePageAdvisorModal();
    },
  });
}

function showPageAdvisorLayer() {
  syncPageAdvisorFocusTrap();
  startPageAdvisorDomWatcher();
}

/**
 * Content → SW：采集页面上下文 + 当前浮窗工作空间/租户。
 */
function getPageAdvisorContextFromFloat() {
  const Capture = typeof PageContext !== 'undefined' ? PageContext : null;
  const pendingRegion = (typeof getPendingPageAdvisorRegion === 'function')
    ? getPendingPageAdvisorRegion()
    : null;
  const page = Capture
    ? (pendingRegion && Capture.capturePageContextInRect
      ? Capture.capturePageContextInRect({ stampNids: true, region: pendingRegion })
      : Capture.capturePageContext({ stampNids: true }))
    : {
      url: location.href,
      title: document.title,
      pageText: '',
      pageTextTruncated: false,
      domOutline: [],
    };
  if (typeof clearPendingPageAdvisorRegion === 'function') {
    clearPendingPageAdvisorRegion();
  }

  const workspaceId = (typeof wsSelect !== 'undefined' && wsSelect?.value)
    ? String(wsSelect.value).trim()
    : '';
  let companyId = '';
  if (workspaceId && typeof workspacesData !== 'undefined' && Array.isArray(workspacesData)) {
    const ws = workspacesData.find((w) => String(w.id || w._id) === workspaceId);
    companyId = String(ws?.company_id || ws?.companyId || '').trim();
  }

  return {
    success: true,
    data: {
      url: page.url,
      title: page.title,
      pageText: page.pageText,
      pageTextTruncated: page.pageTextTruncated,
      domOutline: Array.isArray(page.domOutline) ? page.domOutline : [],
      workspaceId,
      companyId,
      tenantId: companyId,
      regionScoped: !!page.regionScoped,
    },
  };
}

function handlePageAdvisorResultMessage(msg) {
  if (msg.phase === 'loading') {
    showPageAdvisorLoading(msg.message || '生成中…');
    return;
  }
  if (!msg.ok) {
    if (msg.errorCode === 'AGENT_RESOURCE_NOT_CONFIGURED' || msg.links) {
      showPageAdvisorResourceError(msg);
      return;
    }
    ensurePageAdvisorLayer();
    showPageAdvisorLoading('');
    const cards = document.getElementById('taskplugin-page-advisor-cards');
    if (cards) cards.innerHTML = '';
    const errText = msg.error || '页面优化建议失败';
    setPageAdvisorError(errText, msg.traceId);
    openFloatPanelForAdvisor();
    const layer = document.getElementById('taskplugin-page-advisor-layer');
    if (layer) layer.hidden = false;
    syncPageAdvisorFillButtons();
    showPageAdvisorLayer();
    const retryBtn = document.getElementById('taskplugin-page-advisor-retry');
    if (retryBtn) {
      retryBtn.hidden = false;
      retryBtn.disabled = false;
    }
    return;
  }
  if (msg.phase === 'done' || Array.isArray(msg.suggestions)) {
    showPageAdvisorSuggestions(msg);
  }
}
