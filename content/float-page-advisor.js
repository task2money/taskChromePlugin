/**
 * Alt+E 页面优化建议 UI：锚定悬浮卡 + 可逆 DOM 预览 + 全部/逐条填入。
 * 须在 float-boot / float-form 之后、content.js 之前注入。
 */

"use strict";

var pageAdvisorBusy = false;
var pageAdvisorConfirmGuard =
  typeof ClickGuard !== "undefined" && ClickGuard.createClickGuard
    ? ClickGuard.createClickGuard({ debounceMs: 400 })
    : null;
var pageAdvisorDismissGuard =
  typeof ClickGuard !== "undefined" && ClickGuard.createClickGuard
    ? ClickGuard.createClickGuard({ debounceMs: 300 })
    : null;
var pageAdvisorState = {
  suggestions: [],
  pageUrl: "",
  jobId: "",
};
var pageAdvisorPreviewSession = null;
var pageAdvisorLayoutRaf = 0;

function getPageAdvisorPreviewSession() {
  if (pageAdvisorPreviewSession) return pageAdvisorPreviewSession;
  const Preview =
    typeof PageAdvisorPreview !== "undefined" ? PageAdvisorPreview : null;
  if (!Preview) return null;
  pageAdvisorPreviewSession = Preview.createPreviewSession({
    document,
    resolveNid: (nid) => {
      const id = String(nid || "").replace(/"/g, "");
      return document.querySelector(`[data-taskplugin-nid="${id}"]`);
    },
  });
  return pageAdvisorPreviewSession;
}

function ensurePageAdvisorLayer() {
  let layer = document.getElementById("taskplugin-page-advisor-layer");
  if (layer) return layer;

  layer = document.createElement("div");
  layer.id = "taskplugin-page-advisor-layer";
  layer.hidden = true;
  const A11y = typeof PageAdvisorA11y !== "undefined" ? PageAdvisorA11y : null;
  layer.innerHTML =
    A11y && A11y.buildLayerHtml
      ? A11y.buildLayerHtml(esc)
      : '<div id="taskplugin-page-advisor-cards"></div><div id="taskplugin-page-advisor-toolbar" role="toolbar" aria-label="优化建议操作栏" aria-describedby="taskplugin-page-advisor-hint"><p class="taskplugin-page-advisor-toolbar-hint taskplugin-page-advisor-safety-hint" id="taskplugin-page-advisor-hint">填入仅写入任务描述，不会自动创建任务</p></div>';
  if (root) root.appendChild(layer);
  else document.body.appendChild(layer);

  document
    .getElementById("taskplugin-page-advisor-cancel")
    ?.addEventListener("click", () => {
      // Anti-Replay-OK: ui-only — 关闭建议层并还原预览
      closePageAdvisorModal();
    });
  document
    .getElementById("taskplugin-page-advisor-fill-all")
    ?.addEventListener("click", () => {
      void confirmPageAdvisorFill({ mode: "all" });
    });
  document
    .getElementById("taskplugin-page-advisor-fill-one")
    ?.addEventListener("click", () => {
      void confirmPageAdvisorFill({ mode: "one" });
    });
  document
    .getElementById("taskplugin-page-advisor-retry")
    ?.addEventListener("click", () => {
      // Anti-Replay-OK: re-triggers Alt+E flow via runtime message
      const retryBtn = document.getElementById("taskplugin-page-advisor-retry");
      if (retryBtn) retryBtn.hidden = true;
      setPageAdvisorError("");
      showPageAdvisorLoading("正在采集页面并生成优化建议…");
      try {
        chrome.runtime.sendMessage(
          { action: "pageOptimizationSuggest" },
          () => {
            void chrome.runtime.lastError;
          },
        );
      } catch (e) {
        setPageAdvisorError(e?.message || "重试失败");
      }
    });

  window.addEventListener("scroll", schedulePageAdvisorLayout, true);
  window.addEventListener("resize", schedulePageAdvisorLayout);

  return layer;
}

function schedulePageAdvisorLayout() {
  if (pageAdvisorLayoutRaf) return;
  pageAdvisorLayoutRaf = requestAnimationFrame(() => {
    pageAdvisorLayoutRaf = 0;
    layoutPageAdvisorCards();
  });
}

function closePageAdvisorModal() {
  stopPageAdvisorDomWatcher();
  const Trap = typeof DialogFocusTrap !== "undefined" ? DialogFocusTrap : null;
  const layer = document.getElementById("taskplugin-page-advisor-layer");
  if (Trap && layer && Trap.isFocusTrapActiveFor(layer)) {
    Trap.deactivateFocusTrap({ restoreFocus: false });
  }
  if (layer) layer.hidden = true;
  if (typeof restorePageAdvisorDocumentTitle === "function")
    restorePageAdvisorDocumentTitle();
  const session = getPageAdvisorPreviewSession();
  session?.undoAll();
  if (typeof PageContext !== "undefined" && PageContext.clearDomNids) {
    PageContext.clearDomNids(document);
  }
  pageAdvisorState = { suggestions: [], pageUrl: "", jobId: "" };
  if (typeof clearAllPageAdvisorPins === "function") clearAllPageAdvisorPins();
  const cards = document.getElementById("taskplugin-page-advisor-cards");
  if (cards) cards.innerHTML = "";
  setPageAdvisorLiveStatus("");
  const err = document.getElementById("taskplugin-page-advisor-error");
  if (err) {
    err.className = "taskplugin-result";
    err.textContent = "";
    err.removeAttribute("data-traceId");
  }
  const links = document.getElementById("taskplugin-page-advisor-links");
  if (links) {
    links.hidden = true;
    links.innerHTML = "";
  }
  syncPageAdvisorFillButtons();
  if (typeof btn !== "undefined" && btn && typeof btn.focus === "function")
    btn.focus();
  if (typeof syncFloatPanelFocusTrap === "function") syncFloatPanelFocusTrap();
}

function setPageAdvisorError(msg, traceId) {
  const err = document.getElementById("taskplugin-page-advisor-error");
  if (!err) return;
  err.textContent = msg || "";
  err.className = msg
    ? "taskplugin-result taskplugin-show taskplugin-result-error"
    : "taskplugin-result";
  if (msg) {
    err.setAttribute("role", "alert");
    err.setAttribute("aria-live", "assertive");
  } else {
    err.removeAttribute("role");
    err.removeAttribute("aria-live");
  }
  if (msg && traceId && typeof setDataTraceId === "function") {
    setDataTraceId(err, traceId);
  } else if (msg && traceId) {
    err.setAttribute("data-traceId", String(traceId));
  } else {
    err.removeAttribute("data-traceId");
  }
}

function openFloatPanelForAdvisor() {
  if (typeof isOpen !== "undefined" && !isOpen && panel && btn) {
    isOpen = true;
    panel.classList.add("taskplugin-open");
    btn.classList.add("taskplugin-active");
  }
}

function setPageAdvisorLiveStatus(message) {
  const live = document.getElementById("taskplugin-page-advisor-live");
  if (live) live.textContent = message || "";
}

function showPageAdvisorLoading(message) {
  const layer = ensurePageAdvisorLayer();
  const A11y = typeof PageAdvisorA11y !== "undefined" ? PageAdvisorA11y : null;
  const text =
    message || (A11y ? A11y.loadingDefault : "正在采集页面并生成优化建议…");
  const cards = document.getElementById("taskplugin-page-advisor-cards");
  if (cards) {
    cards.innerHTML = `<div class="taskplugin-page-advisor-status-card" role="status" aria-live="polite" aria-atomic="true">${esc(text)}</div>`;
  }
  setPageAdvisorLiveStatus(text);
  syncPageAdvisorFillButtons();
  const links = document.getElementById("taskplugin-page-advisor-links");
  if (links) {
    links.hidden = true;
    links.innerHTML = "";
  }
  setPageAdvisorError("");
  openFloatPanelForAdvisor();
  layer.hidden = false;
  showPageAdvisorLayer();
}

function onPageAdvisorCheckChange(ev) {
  const input = ev.target;
  if (!input || !input.classList.contains("taskplugin-page-advisor-check"))
    return;
  const id = String(input.value || "");
  const sug = pageAdvisorState.suggestions.find((s) => String(s.id) === id);
  const session = getPageAdvisorPreviewSession();
  if (!sug || !session) {
    syncPageAdvisorFillButtons();
    return;
  }
  if (input.checked) {
    session.applySuggestion(sug);
  } else {
    session.undoOne(id);
  }
  syncPageAdvisorFillButtons();
}

/**
 * 关闭单条建议：撤销预览 + 清 pin + 移除卡 + 更新状态（不写入任务描述）。
 * @param {string} sid
 * @returns {{ dismissed: boolean }}
 */
function dismissPageAdvisorSuggestion(sid) {
  const id = String(sid || "");
  if (!id) return { dismissed: false };
  const session = getPageAdvisorPreviewSession();
  session?.undoOne(id);
  if (typeof clearPageAdvisorPin === "function") clearPageAdvisorPin(id);
  const safe = id.replace(/"/g, "");
  const card = document.querySelector(
    `.taskplugin-page-advisor-float-card[data-sid="${safe}"]`,
  );
  card?.remove();
  pageAdvisorState.suggestions = pageAdvisorState.suggestions.filter(
    (s) => String(s.id) !== id,
  );
  const root = document.getElementById("taskplugin-page-advisor-cards");
  if (root) {
    root
      .querySelectorAll(".taskplugin-page-advisor-float-card")
      .forEach((el, i) => {
        el.setAttribute("data-order", String(i));
        const check = el.querySelector(".taskplugin-page-advisor-check");
        if (check) check.setAttribute("data-order", String(i));
      });
  }
  syncPageAdvisorFillButtons();
  if (typeof layoutPageAdvisorCards === "function") layoutPageAdvisorCards();
  if (!pageAdvisorState.suggestions.length) {
    closePageAdvisorModal();
  }
  return { dismissed: true };
}

function bindPageAdvisorCardDismiss(root) {
  if (!root) return;
  root.querySelectorAll(".taskplugin-page-advisor-dismiss").forEach((btnEl) => {
    if (btnEl.getAttribute("data-dismiss-bound") === "1") return;
    btnEl.setAttribute("data-dismiss-bound", "1");
    btnEl.addEventListener("mousedown", (ev) => {
      ev.stopPropagation();
    });
    btnEl.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const card = btnEl.closest(".taskplugin-page-advisor-float-card");
      const sid = card
        ? String(card.getAttribute("data-sid") || "")
        : String(btnEl.getAttribute("data-sid") || "");
      const run = () => dismissPageAdvisorSuggestion(sid);
      if (pageAdvisorDismissGuard) {
        void pageAdvisorDismissGuard.run(async () => run());
        return;
      }
      run();
    });
  });
}

function showPageAdvisorSuggestions(payload) {
  const layer = ensurePageAdvisorLayer();
  const cards = document.getElementById("taskplugin-page-advisor-cards");
  const links = document.getElementById("taskplugin-page-advisor-links");
  const suggestions = Array.isArray(payload?.suggestions)
    ? payload.suggestions
    : [];
  pageAdvisorState = {
    suggestions,
    pageUrl: String(payload?.pageUrl || ""),
    jobId: String(payload?.jobId || ""),
  };

  getPageAdvisorPreviewSession()?.undoAll();

  if (links) {
    links.hidden = true;
    links.innerHTML = "";
  }

  const A11y = typeof PageAdvisorA11y !== "undefined" ? PageAdvisorA11y : null;
  const readyMsg =
    A11y && A11y.formatReadyStatus
      ? A11y.formatReadyStatus(suggestions.length)
      : suggestions.length
        ? `已生成 ${suggestions.length} 条优化建议`
        : "未返回可用建议";
  setPageAdvisorLiveStatus(readyMsg);

  if (!suggestions.length) {
    if (cards) {
      cards.innerHTML = `<div class="taskplugin-page-advisor-status-card" role="status" aria-live="polite" aria-atomic="true">${esc(readyMsg)}</div>`;
    }
  } else if (cards) {
    cards.innerHTML = suggestions
      .map((s, idx) => {
        const id = String(s.id != null ? s.id : `s${idx}`);
        const title = esc(s.title || "建议");
        const summary = esc(s.summary || s.detail || "");
        return `
        <div class="taskplugin-page-advisor-float-card" data-order="${idx}" data-sid="${esc(id)}">
          <div class="taskplugin-page-advisor-card-chrome">
            <div class="taskplugin-page-advisor-drag-handle" role="button" tabindex="0"
              aria-label="拖动建议卡，双击复位" title="拖动移动；双击把手复位">⋮⋮</div>
            <button type="button" class="taskplugin-page-advisor-dismiss" data-sid="${esc(id)}"
              aria-label="关闭此建议" title="关闭并还原此条预览">×</button>
          </div>
          <label class="taskplugin-page-advisor-item">
            <input type="checkbox" class="taskplugin-page-advisor-check" value="${esc(id)}" data-order="${idx}" checked>
            <span class="taskplugin-page-advisor-item-body">
              <strong>${title}</strong>
              <span class="taskplugin-page-advisor-summary">${summary}</span>
            </span>
          </label>
        </div>
      `;
      })
      .join("");
    if (typeof clearAllPageAdvisorPins === "function")
      clearAllPageAdvisorPins();
    cards.querySelectorAll(".taskplugin-page-advisor-check").forEach((el) => {
      el.addEventListener("change", onPageAdvisorCheckChange);
      // 默认勾选 → 立即预览
      const id = String(el.value || "");
      const sug = pageAdvisorState.suggestions.find((s) => String(s.id) === id);
      if (sug) getPageAdvisorPreviewSession()?.applySuggestion(sug);
    });
    if (typeof bindPageAdvisorCardDrags === "function")
      bindPageAdvisorCardDrags(cards);
    bindPageAdvisorCardDismiss(cards);
  }

  setPageAdvisorError("");
  openFloatPanelForAdvisor();
  layer.hidden = false;
  syncPageAdvisorFillButtons();
  layoutPageAdvisorCards();
  showPageAdvisorLayer();
}

function showPageAdvisorResourceError(payload) {
  const layer = ensurePageAdvisorLayer();
  const cards = document.getElementById("taskplugin-page-advisor-cards");
  const links = document.getElementById("taskplugin-page-advisor-links");
  if (cards) {
    cards.innerHTML = `<div class="taskplugin-page-advisor-status-card">${esc(payload?.message || "未配置智能体资源")}</div>`;
  }
  if (links && Array.isArray(payload?.links)) {
    links.hidden = false;
    links.innerHTML = payload.links
      .map((l) => {
        const href = esc(l.href || "#");
        const label = esc(l.label || l.href || "");
        // Anti-Replay-OK: real <a href> navigation to settings — no write API
        return `<a class="taskplugin-page-advisor-link" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      })
      .join("");
  }
  setPageAdvisorError(payload?.message || "", payload?.traceId);
  syncPageAdvisorFillButtons();
  openFloatPanelForAdvisor();
  layer.hidden = false;
  showPageAdvisorLayer();
}

function collectSelectedSuggestionIds() {
  const checks = document.querySelectorAll(
    "#taskplugin-page-advisor-cards .taskplugin-page-advisor-check:checked",
  );
  const ordered = Array.from(checks).sort((a, b) => {
    const ao = Number(a.getAttribute("data-order") || 0);
    const bo = Number(b.getAttribute("data-order") || 0);
    return ao - bo;
  });
  return ordered.map((el) => el.value);
}

function syncPageAdvisorFillButtons() {
  const ids = collectSelectedSuggestionIds();
  const allBtn = document.getElementById("taskplugin-page-advisor-fill-all");
  const oneBtn = document.getElementById("taskplugin-page-advisor-fill-one");
  const A11y = typeof PageAdvisorA11y !== "undefined" ? PageAdvisorA11y : null;
  const disabled = ids.length === 0;
  if (allBtn) {
    allBtn.disabled = disabled;
    allBtn.setAttribute("aria-busy", "false");
    allBtn.textContent = A11y ? A11y.fillAllLabel : "全部填入任务描述";
  }
  if (oneBtn) {
    oneBtn.disabled = disabled;
    oneBtn.setAttribute("aria-busy", "false");
    oneBtn.textContent = A11y ? A11y.fillOneLabel : "逐条填入任务描述";
  }
}

async function confirmPageAdvisorFill(opts = {}) {
  const mode = opts.mode === "one" ? "one" : "all";
  const allBtn = document.getElementById("taskplugin-page-advisor-fill-all");
  const oneBtn = document.getElementById("taskplugin-page-advisor-fill-one");
  const activeBtn = mode === "one" ? oneBtn : allBtn;

  const runFill = () => {
    let selectedIds = collectSelectedSuggestionIds();
    if (!selectedIds.length) {
      setPageAdvisorError("请至少勾选一条建议");
      return { filled: false };
    }
    if (mode === "one") {
      selectedIds = [selectedIds[0]];
    }
    const Fill =
      typeof PageAdvisorFill !== "undefined" ? PageAdvisorFill : null;
    if (!Fill) {
      setPageAdvisorError("PageAdvisorFill 未加载");
      return { filled: false };
    }
    const next = Fill.appendSuggestionsToDescription(
      descInput ? descInput.value : "",
      pageAdvisorState.suggestions,
      selectedIds,
      pageAdvisorState.pageUrl,
    );
    if (descInput) {
      descInput.value = next;
      if (typeof syncDescResetButton === "function") syncDescResetButton();
    }
    openFloatPanelForAdvisor();

    const session = getPageAdvisorPreviewSession();
    if (mode === "all") {
      session?.undoAll();
      closePageAdvisorModal();
      if (typeof showResult === "function") {
        showResult("已将优化建议填入任务描述（未自动创建任务）", "success");
      }
    } else {
      const id = selectedIds[0];
      dismissPageAdvisorSuggestion(id);
      if (typeof showResult === "function") {
        showResult("已填入一条建议（未自动创建任务）", "success");
      }
    }
    return { filled: true, createTaskCalled: false };
  };

  if (pageAdvisorConfirmGuard) {
    if (activeBtn) {
      activeBtn.disabled = true;
      activeBtn.setAttribute("aria-busy", "true");
      activeBtn.textContent = "填入中…";
    }
    try {
      const outcome = await pageAdvisorConfirmGuard.run(async () => runFill());
      if (outcome.skipped) return;
    } finally {
      syncPageAdvisorFillButtons();
    }
    return;
  }

  if (pageAdvisorBusy) return;
  pageAdvisorBusy = true;
  try {
    runFill();
  } finally {
    pageAdvisorBusy = false;
    syncPageAdvisorFillButtons();
  }
}
