/**
 * Alt+E 建议层：焦点陷阱、DOM 预览 watcher（从 float-page-advisor.js 抽出以满足行数门禁）。
 */

"use strict";

var pageAdvisorDomWatcher = null;

function isPageAdvisorLayerVisible() {
  const layer = document.getElementById("taskplugin-page-advisor-layer");
  return !!(layer && !layer.hidden);
}

function isPageAdvisorSuggestionSelected(id) {
  const sid = String(id || "").replace(/"/g, '\\"');
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
  const Preview =
    typeof PageAdvisorPreview !== "undefined" ? PageAdvisorPreview : null;
  const session =
    typeof getPageAdvisorPreviewSession === "function"
      ? getPageAdvisorPreviewSession()
      : null;
  if (!Preview?.createPreviewDomWatcher || !session) return;
  pageAdvisorDomWatcher = Preview.createPreviewDomWatcher({
    document,
    session,
    getSuggestions: () => pageAdvisorState.suggestions,
    resolveNid: (nid) => {
      const nidId = String(nid || "").replace(/"/g, "");
      return document.querySelector(`[data-taskplugin-nid="${nidId}"]`);
    },
    isSelected: (sid) => isPageAdvisorSuggestionSelected(sid),
    debounceMs: 80,
  });
  pageAdvisorDomWatcher.start();
}

var pageAdvisorSavedDocumentTitle = null;

function applyPageAdvisorDocumentTitle() {
  const A11y = typeof PageAdvisorA11y !== "undefined" ? PageAdvisorA11y : null;
  if (!A11y || !A11y.documentTitle) return;
  if (pageAdvisorSavedDocumentTitle == null) {
    pageAdvisorSavedDocumentTitle = document.title;
  }
  document.title = A11y.documentTitle;
}

function restorePageAdvisorDocumentTitle() {
  if (pageAdvisorSavedDocumentTitle == null) return;
  document.title = pageAdvisorSavedDocumentTitle;
  pageAdvisorSavedDocumentTitle = null;
}

function syncPageAdvisorFocusTrap() {
  const Trap = typeof DialogFocusTrap !== "undefined" ? DialogFocusTrap : null;
  const layer = document.getElementById("taskplugin-page-advisor-layer");
  if (!Trap || !layer || layer.hidden) return;
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-labelledby", "taskplugin-page-advisor-heading");
  layer.removeAttribute("aria-label");
  const returnEl = typeof btn !== "undefined" && btn ? btn : null;
  Trap.activateFocusTrap(layer, {
    returnFocusEl: returnEl,
    onEscape: () => {
      if (typeof closePageAdvisorModal === "function") closePageAdvisorModal();
    },
  });
}

function retryPageAdvisorSuggestFromToolbar() {
  const retryBtn = document.getElementById("taskplugin-page-advisor-retry");
  if (retryBtn) retryBtn.hidden = true;
  setPageAdvisorError("");
  showPageAdvisorLoading("正在采集页面并生成优化建议…");
  if (typeof restorePageAdvisorLastCaptureForRetry === "function") {
    restorePageAdvisorLastCaptureForRetry();
  }
  try {
    chrome.runtime.sendMessage({ action: "pageOptimizationSuggest" }, () => {
      void chrome.runtime.lastError;
    });
  } catch (e) {
    setPageAdvisorError(e?.message || "重试失败");
  }
}

function focusAfterPageAdvisorDismiss() {
  if (typeof isPageAdvisorLayerVisible === "function" && !isPageAdvisorLayerVisible()) {
    if (typeof descInput !== "undefined" && descInput && typeof descInput.focus === "function") {
      descInput.focus();
    }
    return;
  }
  const fillOne = document.getElementById("taskplugin-page-advisor-fill-one");
  if (fillOne && !fillOne.disabled && typeof fillOne.focus === "function") {
    fillOne.focus();
    return;
  }
  const cardsRoot = document.getElementById("taskplugin-page-advisor-cards");
  const card = cardsRoot?.querySelector(".taskplugin-page-advisor-float-card");
  if (!card) return;
  const dismissBtn = card.querySelector(".taskplugin-page-advisor-dismiss");
  const check = card.querySelector(".taskplugin-page-advisor-check");
  const target = dismissBtn || check;
  if (target && typeof target.focus === "function") target.focus();
}

function syncFloatPanelPrimaryHeading() {
  const floatTitle = document.getElementById("taskplugin-float-title");
  if (!floatTitle) return;
  const advisorOpen =
    typeof isPageAdvisorLayerVisible === "function" &&
    isPageAdvisorLayerVisible();
  const wantTag = advisorOpen ? "h2" : "h1";
  const current = floatTitle.tagName.toLowerCase();
  if (current === wantTag) return;
  const replacement = document.createElement(wantTag);
  replacement.id = "taskplugin-float-title";
  replacement.className = floatTitle.className || "taskplugin-float-heading";
  replacement.textContent = floatTitle.textContent || "快速创建任务";
  floatTitle.replaceWith(replacement);
}

/**
 * 自动创新进行中：收起「快速创建任务」浮窗，仅展示建议卡/底栏。
 * 填入任务描述后再由 openFloatPanelForAdvisor 打开建任务面板。
 */
function collapseFloatPanelDuringAdvisor() {
  if (typeof panel !== "undefined" && panel) {
    panel.classList.remove("taskplugin-open");
  }
  if (typeof btn !== "undefined" && btn) {
    btn.classList.remove("taskplugin-active");
    if (typeof pickMode === "undefined" || !pickMode) {
      btn.textContent = "+";
    }
  }
  if (typeof isOpen !== "undefined") {
    isOpen = false;
  }
}

/** 全部/逐条填入任务描述后打开「快速创建任务」浮窗。 */
function openFloatPanelForAdvisor() {
  if (typeof isOpen !== "undefined" && !isOpen && panel && btn) {
    isOpen = true;
    panel.classList.add("taskplugin-open");
    btn.classList.add("taskplugin-active");
    btn.textContent = "×";
  }
}

function showPageAdvisorLayer() {
  applyPageAdvisorDocumentTitle();
  syncFloatPanelPrimaryHeading();
  syncPageAdvisorFocusTrap();
  startPageAdvisorDomWatcher();
}

function queryPageAdvisorNidElement(nid) {
  const id = String(nid || "").trim().replace(/"/g, "");
  if (!id) return null;
  try {
    return document.querySelector(`[data-taskplugin-nid="${id}"]`);
  } catch (_) {
    return null;
  }
}

/**
 * Resolve the host page element for layout + hover highlight.
 * Order: target_nid → first still-present preview.ops[].nid → anchor_text.
 */
function resolveSuggestionAnchor(suggestion) {
  const byTarget = queryPageAdvisorNidElement(suggestion?.target_nid);
  if (byTarget) return byTarget;

  const ops = suggestion?.preview?.ops;
  if (Array.isArray(ops)) {
    for (const op of ops) {
      const el = queryPageAdvisorNidElement(op?.nid);
      if (el) return el;
    }
  }

  const anchor = String(suggestion?.anchor_text || "").trim();
  if (anchor && anchor.length >= 2) {
    const stamped = document.querySelectorAll("[data-taskplugin-nid]");
    for (const el of stamped) {
      const t = String(el.textContent || "").replace(/\s+/g, " ");
      if (t.includes(anchor)) return el;
    }
  }
  return null;
}

/** Distinct from pick-mode `.taskplugin-el-highlight` (needs html.taskplugin-picking). */
var pageAdvisorRegionHighlightEls = [];

function ensurePageAdvisorRegionHighlightStyle(doc) {
  if (!doc || doc.getElementById("taskplugin-advisor-region-hl-style")) return;
  const s = doc.createElement("style");
  s.id = "taskplugin-advisor-region-hl-style";
  s.textContent =
    ".taskplugin-advisor-region-highlight{outline:2px solid #f9e2af!important;"
    + "outline-offset:2px!important;"
    + "box-shadow:0 0 0 4px rgba(249,226,175,.4)!important;}";
  (doc.head || doc.documentElement).appendChild(s);
}

function clearPageAdvisorRegionHighlight() {
  for (const el of pageAdvisorRegionHighlightEls) {
    try {
      el.classList.remove("taskplugin-advisor-region-highlight");
    } catch (_) {
      /* detached */
    }
  }
  pageAdvisorRegionHighlightEls = [];
}

function applyPageAdvisorRegionHighlight(el) {
  clearPageAdvisorRegionHighlight();
  if (!el || el.nodeType !== 1) return;
  const owner = el.ownerDocument || document;
  ensurePageAdvisorRegionHighlightStyle(owner);
  el.classList.add("taskplugin-advisor-region-highlight");
  pageAdvisorRegionHighlightEls.push(el);
}

function highlightPageAdvisorCardRegion(card) {
  const sid = String(card?.getAttribute?.("data-sid") || "");
  const sug =
    typeof pageAdvisorState !== "undefined" && pageAdvisorState?.suggestions
      ? pageAdvisorState.suggestions.find((s) => String(s.id) === sid)
      : null;
  const anchor = sug ? resolveSuggestionAnchor(sug) : null;
  if (anchor) applyPageAdvisorRegionHighlight(anchor);
  else clearPageAdvisorRegionHighlight();
}

function bindPageAdvisorCardRegionHover(root) {
  if (!root) return;
  root.querySelectorAll(".taskplugin-page-advisor-float-card").forEach((card) => {
    if (card.getAttribute("data-region-hover-bound") === "1") return;
    card.setAttribute("data-region-hover-bound", "1");
    card.addEventListener("mouseenter", () => {
      highlightPageAdvisorCardRegion(card);
    });
    card.addEventListener("mouseleave", () => {
      clearPageAdvisorRegionHighlight();
    });
    card.addEventListener("focusin", () => {
      highlightPageAdvisorCardRegion(card);
    });
    card.addEventListener("focusout", (e) => {
      if (e?.relatedTarget && card.contains(e.relatedTarget)) return;
      clearPageAdvisorRegionHighlight();
    });
  });
}

function layoutPageAdvisorCards() {
  const cardsRoot = document.getElementById("taskplugin-page-advisor-cards");
  if (!cardsRoot) return;
  const Layout =
    typeof PageAdvisorCardLayout !== "undefined" ? PageAdvisorCardLayout : null;
  const cardEls = Array.from(
    cardsRoot.querySelectorAll(".taskplugin-page-advisor-float-card"),
  );
  if (!cardEls.length) return;

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  let cornerIndex = 0;
  const specs = cardEls.map((card) => {
    const idx = Number(card.getAttribute("data-order") || 0);
    const sid = String(card.getAttribute("data-sid") || "");
    const sug =
      pageAdvisorState.suggestions.find((s) => String(s.id) === sid) ||
      pageAdvisorState.suggestions[idx];
    const anchor = sug ? resolveSuggestionAnchor(sug) : null;
    const width = Math.max(160, card.offsetWidth || 260);
    const height = Math.max(48, card.offsetHeight || 80);
    const pin =
      typeof getPageAdvisorPin === "function" ? getPageAdvisorPin(sid) : null;

    if (pin) {
      card.classList.add("taskplugin-page-advisor-pinned");
      card.classList.remove("taskplugin-page-advisor-corner");
      return {
        sid,
        order: idx,
        mode: "pinned",
        top: pin.top,
        left: pin.left,
        preferredTop: pin.top,
        preferredLeft: pin.left,
        width,
        height,
        el: card,
      };
    }

    if (anchor) {
      const r = anchor.getBoundingClientRect();
      let preferredTop = Math.max(8, Math.min(window.innerHeight - 120, r.top));
      let preferredLeft = Math.min(window.innerWidth - width - 8, r.right + 8);
      if (preferredLeft < 8) preferredLeft = Math.max(8, r.left - width - 8);
      card.classList.remove("taskplugin-page-advisor-corner");
      card.classList.remove("taskplugin-page-advisor-pinned");
      return {
        sid,
        order: idx,
        mode: "anchored",
        preferredTop,
        preferredLeft,
        width,
        height,
        el: card,
      };
    }

    const preferredTop = Math.max(
      8,
      window.innerHeight - 160 - cornerIndex * 96,
    );
    const preferredLeft = Math.max(8, window.innerWidth - 300);
    cornerIndex += 1;
    card.classList.add("taskplugin-page-advisor-corner");
    card.classList.remove("taskplugin-page-advisor-pinned");
    return {
      sid,
      order: idx,
      mode: "corner",
      preferredTop,
      preferredLeft,
      width,
      height,
      el: card,
    };
  });

  const resolved = Layout
    ? Layout.resolveAdvisorCardPositions(specs, viewport, { gap: 8 })
    : specs.map((s) => ({
        ...s,
        top: s.top != null ? s.top : s.preferredTop,
        left: s.left != null ? s.left : s.preferredLeft,
      }));

  const bySid = new Map(resolved.map((r) => [String(r.sid), r]));
  specs.forEach((spec) => {
    const pos = bySid.get(String(spec.sid)) || spec;
    const card = spec.el;
    card.style.top = `${Math.round(pos.top)}px`;
    card.style.left = `${Math.round(pos.left)}px`;
    card.style.zIndex = String(2147483640 + (Number(spec.order) || 0));
  });
}

/**
 * Content → SW：采集页面上下文 + 当前浮窗工作空间/租户。
 */
function getPageAdvisorContextFromFloat() {
  const Capture = typeof PageContext !== "undefined" ? PageContext : null;
  const pendingEls =
    typeof getPendingPageAdvisorElements === "function"
      ? getPendingPageAdvisorElements()
      : null;
  const pendingRegion =
    typeof getPendingPageAdvisorRegion === "function"
      ? getPendingPageAdvisorRegion()
      : null;
  if (pendingRegion && typeof rememberPageAdvisorLastRegion === "function") {
    rememberPageAdvisorLastRegion(pendingRegion);
  }
  if (
    Array.isArray(pendingEls) &&
    pendingEls.length &&
    typeof unionPageAdvisorElementRects === "function" &&
    typeof rememberPageAdvisorLastRegion === "function"
  ) {
    const union = unionPageAdvisorElementRects(pendingEls);
    if (union) rememberPageAdvisorLastRegion(union);
  }

  let page;
  if (Capture && Array.isArray(pendingEls) && pendingEls.length
    && Capture.capturePageContextForElements) {
    page = Capture.capturePageContextForElements({
      stampNids: true,
      roots: pendingEls,
    });
  } else if (Capture && pendingRegion && Capture.capturePageContextInRect) {
    page = Capture.capturePageContextInRect({
      stampNids: true,
      region: pendingRegion,
    });
  } else if (Capture) {
    page = Capture.capturePageContext({ stampNids: true });
  } else {
    page = {
      url: location.href,
      title: document.title,
      pageText: "",
      pageTextTruncated: false,
      domOutline: [],
    };
  }
  if (typeof clearPendingPageAdvisorElements === "function") {
    clearPendingPageAdvisorElements();
  }
  if (typeof clearPendingPageAdvisorRegion === "function") {
    clearPendingPageAdvisorRegion();
  }

  const workspaceId =
    typeof wsSelect !== "undefined" && wsSelect?.value
      ? String(wsSelect.value).trim()
      : "";
  let companyId = "";
  if (
    workspaceId &&
    typeof workspacesData !== "undefined" &&
    Array.isArray(workspacesData)
  ) {
    const ws = workspacesData.find(
      (w) => String(w.id || w._id) === workspaceId,
    );
    companyId = String(ws?.company_id || ws?.companyId || "").trim();
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
  if (msg.phase === "loading") {
    showPageAdvisorLoading(msg.message || "生成中…");
    return;
  }
  if (!msg.ok) {
    if (msg.errorCode === "AGENT_RESOURCE_NOT_CONFIGURED" || msg.links) {
      showPageAdvisorResourceError(msg);
      return;
    }
    ensurePageAdvisorLayer();
    showPageAdvisorLoading("");
    const cards = document.getElementById("taskplugin-page-advisor-cards");
    if (cards) cards.innerHTML = "";
    const errText = msg.error || "页面优化建议失败";
    setPageAdvisorError(errText, msg.traceId);
    collapseFloatPanelDuringAdvisor();
    const layer = document.getElementById("taskplugin-page-advisor-layer");
    if (layer) layer.hidden = false;
    syncPageAdvisorFillButtons();
    showPageAdvisorLayer();
    const retryBtn = document.getElementById("taskplugin-page-advisor-retry");
    if (retryBtn) {
      retryBtn.hidden = false;
      retryBtn.disabled = false;
    }
    return;
  }
  if (msg.phase === "done" || Array.isArray(msg.suggestions)) {
    showPageAdvisorSuggestions(msg);
  }
}
