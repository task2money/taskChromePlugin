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
