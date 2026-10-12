/**
 * Site pending suggestions UI (confirm / dismiss) — OPT-20260916-029.
 */

"use strict";

var pageAdvisorSitePendingMode = false;
var pageAdvisorSitePendingAnchored = false;

var pageAdvisorSitePendingState = {
  items: [],
  tenantId: "",
  pageUrl: "",
};
var pageAdvisorSitePendingPosts = [];
var pageAdvisorSitePendingActiveId = "";
var pageAdvisorSuggestionSelectedBySidebar = false;
var pageAdvisorSitePendingDeferred = null;
var sitePendingConfirmGuard =
  typeof ClickGuard !== "undefined" && ClickGuard.createClickGuard
    ? ClickGuard.createClickGuard({ debounceMs: 400 })
    : null;
var sitePendingDismissGuard =
  typeof ClickGuard !== "undefined" && ClickGuard.createClickGuard
    ? ClickGuard.createClickGuard({ debounceMs: 300 })
    : null;

function syncSitePendingToolbar() {
  const toolbar = document.getElementById("taskplugin-page-advisor-toolbar");
  let hint = document.getElementById("taskplugin-page-advisor-hint");
  const fillAll = document.getElementById("taskplugin-page-advisor-fill-all");
  const fillOne = document.getElementById("taskplugin-page-advisor-fill-one");
  const cancel = document.getElementById("taskplugin-page-advisor-cancel");
  if (pageAdvisorSitePendingMode) {
    if (toolbar && !hint) {
      hint = document.createElement("p");
      hint.id = "taskplugin-page-advisor-hint";
      hint.className = "taskplugin-page-advisor-toolbar-hint taskplugin-page-advisor-safety-hint";
      const actions = toolbar.querySelector(".taskplugin-page-advisor-toolbar-actions");
      if (actions) toolbar.insertBefore(hint, actions);
      else toolbar.appendChild(hint);
    }
    if (hint) {
      hint.textContent = (typeof tx === "function" ? tx("paSitePendingHint") : "确认后将启动挂起任务；拒绝将关闭本条建议");
    }
    if (fillAll) fillAll.hidden = true;
    if (fillOne) fillOne.hidden = true;
    if (cancel) {
      cancel.textContent = (typeof tx === "function" ? tx("paSitePendingLater") : "稍后再说");
      cancel.title = (typeof tx === "function" ? tx("paSitePendingLaterTitle") : "隐藏待确认面板，稍后可刷新页面再次查看");
    }
  } else {
    if (hint) hint.remove();
  }
  if (!pageAdvisorSitePendingMode && typeof PageAdvisorA11y !== "undefined") {
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
  pageAdvisorSitePendingAnchored = false;
  pageAdvisorSitePendingPosts = [];
  pageAdvisorSitePendingActiveId = "";
  pageAdvisorSuggestionSelectedBySidebar = false;
  concealSitePendingPageOverlay();
}

function concealSitePendingPageOverlay() {
  pageAdvisorSitePendingMode = false;
  pageAdvisorSitePendingAnchored = false;
  syncSitePendingToolbar();
  document.getElementById("taskplugin-page-advisor-post-tabs")?.remove();
  const layer = document.getElementById("taskplugin-page-advisor-layer");
  if (layer) layer.hidden = true;
  const cards = document.getElementById("taskplugin-page-advisor-cards");
  if (cards) cards.innerHTML = "";
  if (typeof restorePageAdvisorDocumentTitle === "function") {
    restorePageAdvisorDocumentTitle();
  }
}

function rememberSitePendingItem(item) {
  if (!item || !item.id) return;
  const Anchor = typeof PageAdvisorAnchor !== "undefined" ? PageAdvisorAnchor : null;
  const rebound = Anchor?.rebindOfflineSuggestionPosts
    ? Anchor.rebindOfflineSuggestionPosts([item])
    : null;
  const post = (rebound && rebound[0]) || {
    id: String(item.id),
    tenantId: String(item.tenant_id || item.tenantId || ""),
    title: String(item.title || ""),
    summary: String(item.summary || ""),
    suggestions: Array.isArray(item.suggestions) ? item.suggestions : [],
  };
  const idx = pageAdvisorSitePendingPosts.findIndex((row) => String(row.id) === String(post.id));
  if (idx >= 0) pageAdvisorSitePendingPosts[idx] = post;
  else pageAdvisorSitePendingPosts.push(post);
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
  const tenantId = String(
    (btnEl && btnEl.getAttribute("data-tenant"))
    || pageAdvisorSitePendingState.tenantId
    || "",
  ).trim();
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
    if (pageAdvisorSitePendingPosts.length) {
      const Pending = typeof PageAdvisorSitePending !== "undefined" ? PageAdvisorSitePending : null;
      pageAdvisorSitePendingPosts = Pending?.sitePendingPostsAfterMark
        ? Pending.sitePendingPostsAfterMark(pageAdvisorSitePendingPosts, sid)
        : pageAdvisorSitePendingPosts.filter((post) => String(post.id) !== sid);
      if (!pageAdvisorSitePendingPosts.length) {
        const cards = document.getElementById("taskplugin-page-advisor-cards");
        if (cards) cards.innerHTML = "";
        hidePageAdvisorSitePendingLayer();
      } else {
        pageAdvisorSitePendingActiveId = Pending?.pickSitePendingPostId
          ? Pending.pickSitePendingPostId(
            pageAdvisorSitePendingPosts,
            pageAdvisorSitePendingActiveId,
          )
          : String(pageAdvisorSitePendingPosts[pageAdvisorSitePendingPosts.length - 1].id || "");
        showActiveSitePendingPost();
      }
    } else if (pageAdvisorSitePendingAnchored) {
      pageAdvisorSitePendingAnchored = false;
      pageAdvisorSitePendingState.items = [];
      const cards = document.getElementById("taskplugin-page-advisor-cards");
      if (cards) cards.innerHTML = "";
      hidePageAdvisorSitePendingLayer();
    } else {
      removeSitePendingCard(sid);
    }
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

function showActiveSitePendingPost() {
  const posts = pageAdvisorSitePendingPosts;
  const Pending = typeof PageAdvisorSitePending !== "undefined" ? PageAdvisorSitePending : null;
  const activeId = Pending?.pickSitePendingPostId
    ? Pending.pickSitePendingPostId(posts, pageAdvisorSitePendingActiveId)
    : pageAdvisorSitePendingActiveId;
  const post = posts.find((item) => String(item.id) === activeId) || posts[posts.length - 1];
  if (!post) {
    hidePageAdvisorSitePendingLayer();
    return;
  }
  pageAdvisorSitePendingActiveId = String(post.id);
  const pageUrl = pageAdvisorSitePendingState.pageUrl;
  if (post.suggestions?.length && typeof showPageAdvisorSuggestions === "function") {
    pageAdvisorSitePendingAnchored = true;
    pageAdvisorSitePendingMode = false;
    if (typeof syncSitePendingToolbar === "function") syncSitePendingToolbar();
    showPageAdvisorSuggestions({
      suggestions: post.suggestions,
      pageUrl,
      sitePending: { id: post.id, tenantId: post.tenantId },
    });
  } else {
    pageAdvisorSuggestionSelectedBySidebar = false;
    concealSitePendingPageOverlay();
  }
  document.getElementById("taskplugin-page-advisor-post-tabs")?.remove();
}

function handlePageAdvisorSitePendingMessage(msg) {
  if (!msg?.ok) return;
  const showingSaved = pageAdvisorSitePendingMode || pageAdvisorSitePendingAnchored;
  if (
    !showingSaved
    && typeof isPageAdvisorLayerVisible === "function"
    && isPageAdvisorLayerVisible()
    && pageAdvisorState?.suggestions?.length
  ) {
    pageAdvisorSitePendingDeferred = msg;
    return;
  }
  const Anchor = typeof PageAdvisorAnchor !== "undefined" ? PageAdvisorAnchor : null;
  const items = Array.isArray(msg.items) ? msg.items : [];
  pageAdvisorSitePendingState.pageUrl = String(msg.pageUrl || "");
  pageAdvisorSitePendingState.tenantId = String(msg.tenantId || "");
  pageAdvisorSitePendingPosts = Anchor?.rebindOfflineSuggestionPosts
    ? Anchor.rebindOfflineSuggestionPosts(items)
    : items.filter((item) => item?.id).map((item) => ({
      id: String(item.id),
      tenantId: String(item.tenant_id || item.tenantId || msg.tenantId || ""),
      title: String(item.title || ""),
      summary: String(item.summary || ""),
      suggestions: [],
    }));
  const Pending = typeof PageAdvisorSitePending !== "undefined" ? PageAdvisorSitePending : null;
  const action = Pending?.nextSitePendingPageAction
    ? Pending.nextSitePendingPageAction(
      "list",
      pageAdvisorSitePendingPosts,
      pageAdvisorSitePendingActiveId,
      { selectedBySidebar: pageAdvisorSuggestionSelectedBySidebar },
    )
    : { kind: "hide-overlay", showPostTabs: false, postId: "" };
  document.getElementById("taskplugin-page-advisor-post-tabs")?.remove();
  if (!pageAdvisorSitePendingPosts.length || action.kind !== "show-suggestion") {
    if (!pageAdvisorSitePendingPosts.length) {
      hidePageAdvisorSitePendingLayer();
    } else if (pageAdvisorSitePendingMode || pageAdvisorSitePendingAnchored) {
      pageAdvisorSuggestionSelectedBySidebar = false;
      concealSitePendingPageOverlay();
    }
    return;
  }
  pageAdvisorSitePendingActiveId = action.postId;
  showActiveSitePendingPost();
}

function handleSelectAgentSuggestionPost(msg) {
  if (msg?.item) rememberSitePendingItem(msg.item);
  const Pending = typeof PageAdvisorSitePending !== "undefined" ? PageAdvisorSitePending : null;
  const action = Pending?.nextSitePendingPageAction
    ? Pending.nextSitePendingPageAction(
      "sidebar-select",
      pageAdvisorSitePendingPosts,
      msg?.postId,
      { selectedBySidebar: true },
    )
    : { kind: "hide-overlay", showPostTabs: false, postId: "" };
  console.info("[taskChromePlugin] agent_suggestion_shown", {
    postId: String(action.postId || ""),
    kind: action.kind,
  });
  if (action.kind !== "show-suggestion") {
    pageAdvisorSuggestionSelectedBySidebar = false;
    pageAdvisorSitePendingActiveId = "";
    concealSitePendingPageOverlay();
    return;
  }
  pageAdvisorSuggestionSelectedBySidebar = true;
  pageAdvisorSitePendingActiveId = action.postId;
  showActiveSitePendingPost();
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
  handlePageAdvisorSitePendingMessage(payload);
}
