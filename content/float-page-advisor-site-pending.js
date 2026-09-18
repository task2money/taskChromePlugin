/**
 * Site pending suggestions UI (confirm / dismiss) — OPT-20260916-029.
 */

"use strict";

var pageAdvisorSitePendingMode = false;

var pageAdvisorSitePendingState = {
  items: [],
  tenantId: "",
  pageUrl: "",
};
var pageAdvisorSitePendingDeferred = null;
var sitePendingConfirmGuard =
  typeof ClickGuard !== "undefined" && ClickGuard.createClickGuard
    ? ClickGuard.createClickGuard({ debounceMs: 400 })
    : null;
var sitePendingDismissGuard =
  typeof ClickGuard !== "undefined" && ClickGuard.createClickGuard
    ? ClickGuard.createClickGuard({ debounceMs: 300 })
    : null;

function patchPageAdvisorModalCloseForSitePending() {
  if (
    typeof closePageAdvisorModal !== "function"
    || closePageAdvisorModal.__sitePendingPatched
  ) {
    return;
  }
  const orig = closePageAdvisorModal;
  closePageAdvisorModal = function patchedClosePageAdvisorModal() {
    if (
      pageAdvisorSitePendingMode
      && !(pageAdvisorState?.suggestions?.length)
    ) {
      hidePageAdvisorSitePendingLayer();
      return;
    }
    return orig();
  };
  closePageAdvisorModal.__sitePendingPatched = true;
}

function syncSitePendingToolbar() {
  const hint = document.getElementById("taskplugin-page-advisor-hint");
  const fillAll = document.getElementById("taskplugin-page-advisor-fill-all");
  const fillOne = document.getElementById("taskplugin-page-advisor-fill-one");
  const cancel = document.getElementById("taskplugin-page-advisor-cancel");
  if (pageAdvisorSitePendingMode) {
    if (hint) {
      hint.textContent = (typeof tx === "function" ? tx("paSitePendingHint") : "确认后将启动挂起任务；拒绝将关闭本条建议");
    }
    if (fillAll) fillAll.hidden = true;
    if (fillOne) fillOne.hidden = true;
    if (cancel) {
      cancel.textContent = (typeof tx === "function" ? tx("paSitePendingLater") : "稍后再说");
      cancel.title = (typeof tx === "function" ? tx("paSitePendingLaterTitle") : "隐藏待确认面板，稍后可刷新页面再次查看");
    }
  } else if (typeof PageAdvisorA11y !== "undefined") {
    if (hint) hint.textContent = PageAdvisorA11y.safetyHint;
    if (fillAll) fillAll.hidden = false;
    if (fillOne) fillOne.hidden = false;
    if (cancel) {
      cancel.textContent = PageAdvisorA11y.cancelLabel;
      cancel.title = PageAdvisorA11y.cancelTitle;
    }
  }
}

function hidePageAdvisorSitePendingLayer() {
  pageAdvisorSitePendingMode = false;
  syncSitePendingToolbar();
  const layer = document.getElementById("taskplugin-page-advisor-layer");
  if (layer) layer.hidden = true;
  if (typeof restorePageAdvisorDocumentTitle === "function") {
    restorePageAdvisorDocumentTitle();
  }
}

function removeSitePendingCard(sid) {
  const id = String(sid || "");
  pageAdvisorSitePendingState.items = pageAdvisorSitePendingState.items.filter(
    (s) => String(s.id) !== id,
  );
  const safe = id.replace(/"/g, "");
  document
    .querySelector(
      `.taskplugin-page-advisor-site-pending-card[data-sid="${safe}"]`,
    )
    ?.remove();
  if (!pageAdvisorSitePendingState.items.length) {
    hidePageAdvisorSitePendingLayer();
    const cards = document.getElementById("taskplugin-page-advisor-cards");
    if (cards) cards.innerHTML = "";
  } else if (typeof layoutPageAdvisorCards === "function") {
    layoutPageAdvisorCards();
  }
}

async function runSitePendingWrite(action, suggestionId, btnEl) {
  const tenantId = String(pageAdvisorSitePendingState.tenantId || "").trim();
  const sid = String(suggestionId || "").trim();
  if (!tenantId || !sid) return;

  const guard = action === "confirm" ? sitePendingConfirmGuard : sitePendingDismissGuard;
  const run = async (ctx) => {
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.setAttribute("aria-busy", "true");
    }
    const resp = await chrome.runtime.sendMessage({
      action: action === "confirm"
        ? "confirmSitePendingSuggestion"
        : "dismissSitePendingSuggestion",
      tenantId,
      suggestionId: sid,
      idempotencyKey: ctx?.idempotencyKey || "",
    });
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.setAttribute("aria-busy", "false");
    }
    if (!resp?.success) {
      const errMsg =
        resp?.error ||
        (typeof tx === "function" ? tx(action === "confirm" ? "paSiteConfirmFail" : "paSiteRejectFail") : (action === "confirm" ? "确认失败" : "拒绝失败"));
      if (typeof setPageAdvisorError === "function") {
        setPageAdvisorError(errMsg, resp?.traceId || "");
      }
      return { ok: false };
    }
    removeSitePendingCard(sid);
    if (typeof showPageToast === "function") {
      showPageToast(
        (typeof tx === "function" ? tx(action === "confirm" ? "paSiteConfirmed" : "paSiteRejected") : (action === "confirm" ? "已确认并启动任务" : "已拒绝该建议")),
      );
    } else if (typeof setPageAdvisorError === "function") {
      setPageAdvisorError("");
    }
    return { ok: true };
  };

  if (guard) {
    await guard.run(run);
    return;
  }
  await run({ idempotencyKey: ClickGuard?.newIdempotencyKey?.() || `ik-${Date.now()}` });
}

function bindSitePendingCardActions(root) {
  if (!root) return;
  root.querySelectorAll(".taskplugin-page-advisor-site-confirm").forEach((btnEl) => {
    if (btnEl.getAttribute("data-site-bound") === "1") return;
    btnEl.setAttribute("data-site-bound", "1");
    btnEl.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void runSitePendingWrite(
        "confirm",
        btnEl.getAttribute("data-sid"),
        btnEl,
      );
    });
  });
  const dismissSelector = ".taskplugin-page-advisor-site-dismiss, .taskplugin-page-advisor-site-dismiss-btn";
  root.querySelectorAll(dismissSelector).forEach((btnEl) => {
    if (btnEl.getAttribute("data-site-bound") === "1") return;
    btnEl.setAttribute("data-site-bound", "1");
    btnEl.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void runSitePendingWrite(
        "dismiss",
        btnEl.getAttribute("data-sid"),
        btnEl,
      );
    });
  });
}

function showPageAdvisorSitePending(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  pageAdvisorSitePendingState = {
    items,
    tenantId: String(payload?.tenantId || ""),
    pageUrl: String(payload?.pageUrl || ""),
  };

  if (
    typeof isPageAdvisorLayerVisible === "function"
    && isPageAdvisorLayerVisible()
    && pageAdvisorState?.suggestions?.length
  ) {
    pageAdvisorSitePendingDeferred = payload;
    return;
  }

  if (!items.length) {
    if (pageAdvisorSitePendingMode) {
      hidePageAdvisorSitePendingLayer();
      const cards = document.getElementById("taskplugin-page-advisor-cards");
      if (cards) cards.innerHTML = "";
    }
    return;
  }

  patchPageAdvisorModalCloseForSitePending();
  if (typeof ensurePageAdvisorLayer === "function") ensurePageAdvisorLayer();

  const Pending = typeof PageAdvisorSitePending !== "undefined"
    ? PageAdvisorSitePending
    : null;
  const cards = document.getElementById("taskplugin-page-advisor-cards");
  if (cards) {
    cards.innerHTML = items
      .map((item, idx) => (
        Pending?.buildSitePendingCardHtml
          ? Pending.buildSitePendingCardHtml(item, idx, esc)
          : `<div data-sid="${esc(String(item.id))}">${esc(item.title || "")}</div>`
      ))
      .join("");
    if (typeof bindPageAdvisorCardDrags === "function") {
      bindPageAdvisorCardDrags(cards);
    }
    bindSitePendingCardActions(cards);
  }

  pageAdvisorSitePendingMode = true;
  syncSitePendingToolbar();
  if (typeof setPageAdvisorError === "function") setPageAdvisorError("");
  if (typeof setPageAdvisorLiveStatus === "function") {
    setPageAdvisorLiveStatus((typeof tx === "function" ? tx("paSitePendingCount", { count: items.length }) : `有 ${items.length} 条待确认的全站优化建议`));
  }
  if (typeof collapseFloatPanelDuringAdvisor === "function") {
    collapseFloatPanelDuringAdvisor();
  }
  const layer = document.getElementById("taskplugin-page-advisor-layer");
  if (layer) layer.hidden = false;
  if (typeof syncPageAdvisorFillButtons === "function") {
    syncPageAdvisorFillButtons();
  }
  if (typeof layoutPageAdvisorCards === "function") layoutPageAdvisorCards();
  if (typeof showPageAdvisorLayer === "function") showPageAdvisorLayer();
}

function handlePageAdvisorSitePendingMessage(msg) {
  if (!msg?.ok) return;
  showPageAdvisorSitePending(msg);
}

function requestSitePendingRefresh(force) {
  const auth = typeof isAuthRoutePath === "function"
    ? isAuthRoutePath(location.pathname)
    : false;
  if (auth) return;
  try {
    chrome.runtime.sendMessage(
      { action: "fetchSitePendingForPage", pageUrl: location.href, force: !!force },
      () => {
        void chrome.runtime.lastError;
      },
    );
  } catch (_) {
    /* ignore */
  }
}

function flushDeferredSitePendingIfAny() {
  if (!pageAdvisorSitePendingDeferred) return;
  const payload = pageAdvisorSitePendingDeferred;
  pageAdvisorSitePendingDeferred = null;
  showPageAdvisorSitePending(payload);
}
