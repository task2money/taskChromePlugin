/**
 * 建议底栏填入：任务描述路径打开创建浮窗；IDE 路径只转发。
 * 从 float-page-advisor.js 抽出以守 500 行。
 */

"use strict";

async function confirmPageAdvisorFill(opts) {
  opts = opts || {};
  const mode = opts.mode === "one" ? "one" : "all";
  const allBtn = document.getElementById("taskplugin-page-advisor-fill-all");
  const oneBtn = document.getElementById("taskplugin-page-advisor-fill-one");
  const activeBtn = mode === "one" ? oneBtn : allBtn;

  const runFill = async () => {
    let selectedIds = collectSelectedSuggestionIds();
    if (!selectedIds.length) {
      setPageAdvisorError((typeof tx === "function" ? tx("paPickOne") : "请至少勾选一条建议"));
      return { filled: false };
    }
    if (mode === "one") {
      selectedIds = [selectedIds[0]];
    }
    const target = typeof loadPageAdvisorDeliveryTarget === "function"
      ? await loadPageAdvisorDeliveryTarget()
      : "task_description";
    if (
      typeof PageAdvisorDelivery !== "undefined"
      && PageAdvisorDelivery.shouldOpenCreatePanel
      && !PageAdvisorDelivery.shouldOpenCreatePanel(target)
    ) {
      if (typeof deliverPageAdvisorSuggestions === "function") {
        return deliverPageAdvisorSuggestions({ mode: mode, selectedIds: selectedIds });
      }
    }
    const Fill =
      typeof PageAdvisorFill !== "undefined" ? PageAdvisorFill : null;
    if (!Fill) {
      setPageAdvisorError((typeof tx === "function" ? tx("paFillModuleMissing") : "PageAdvisorFill 未加载"));
      return { filled: false };
    }
    const prefix = typeof loadPageAdvisorContentPrefix === "function"
      ? await loadPageAdvisorContentPrefix()
      : "";
    const ordered = Fill.orderSelectedSuggestions(pageAdvisorState.suggestions, selectedIds);
    const rawBlock = Fill.formatSuggestionsBlock(ordered, pageAdvisorState.pageUrl);
    const block = typeof PageAdvisorDelivery !== "undefined" && PageAdvisorDelivery.prependContentPrefix
      ? PageAdvisorDelivery.prependContentPrefix(rawBlock, prefix)
      : rawBlock;
    const clip = navigator.clipboard && navigator.clipboard.writeText;
    const copied = await Fill.copySuggestionsBlock(block, clip ? (t) => clip.call(navigator.clipboard, t) : null);
    const current = typeof readCreateDescription === "function"
      ? await readCreateDescription()
      : (descInput ? descInput.value : "");
    const next = Fill.appendSuggestionsToDescription(
      current,
      pageAdvisorState.suggestions,
      selectedIds,
      pageAdvisorState.pageUrl,
      prefix,
    );
    if (typeof writeCreateDescription === "function") await writeCreateDescription(next);
    else if (descInput) descInput.value = next;
    if (
      typeof PageAdvisorDelivery === "undefined"
      || !PageAdvisorDelivery.shouldOpenCreatePanel
      || PageAdvisorDelivery.shouldOpenCreatePanel(target)
    ) {
      openFloatPanelForAdvisor();
    }

    const session = getPageAdvisorPreviewSession();
    if (mode === "all") {
      session?.undoAll();
      closePageAdvisorModal();
    } else {
      dismissPageAdvisorSuggestion(selectedIds[0]);
    }
    if (typeof showResult === "function") {
      showResult(Fill.fillSuccessText(mode, copied, typeof tx === "function" ? tx : null), "success");
    }
    return { filled: true, createTaskCalled: false };
  };

  if (pageAdvisorConfirmGuard) {
    if (activeBtn) {
      activeBtn.disabled = true;
      activeBtn.setAttribute("aria-busy", "true");
      activeBtn.textContent = (typeof tx === "function" ? tx("paFilling") : "填入中…");
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
    await runFill();
  } finally {
    pageAdvisorBusy = false;
    syncPageAdvisorFillButtons();
  }
}
