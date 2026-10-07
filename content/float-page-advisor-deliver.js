/**
 * IDE 送达：剪贴板 + SW deeplink/native。
 * Alt+Z 须点建议底栏按钮触发；Alt+X 确认调整也可按同一渠道发送。
 */

"use strict";

var pageAdvisorDeliveryTargetCache = "task_description";

function loadPageAdvisorDeliveryTarget() {
  return new Promise((resolve) => {
    try {
      if (!chrome.storage || !chrome.storage.local) {
        resolve("task_description");
        return;
      }
      chrome.storage.local.get(["pageAdvisorDeliveryTarget"], (r) => {
        const t =
          typeof PageAdvisorDelivery !== "undefined"
            ? PageAdvisorDelivery.normalizeTarget(r && r.pageAdvisorDeliveryTarget)
            : "task_description";
        pageAdvisorDeliveryTargetCache = t;
        resolve(t);
      });
    } catch (_) {
      resolve("task_description");
    }
  });
}

function applyPageAdvisorDeliveryButtonLabels(allBtn, oneBtn) {
  const t = pageAdvisorDeliveryTargetCache;
  if (
    typeof PageAdvisorDelivery === "undefined"
    || !PageAdvisorDelivery.isIdeDeliveryTarget
    || !PageAdvisorDelivery.isIdeDeliveryTarget(t)
  ) {
    return false;
  }
  const name = PageAdvisorDelivery.ideDisplayName(t, typeof tx === "function" ? tx : null);
  if (allBtn) {
    allBtn.textContent =
      typeof tx === "function" ? tx("paDeliverAgainAll", { name: name }) : `发送到 ${name}`;
  }
  if (oneBtn) {
    oneBtn.textContent =
      typeof tx === "function" ? tx("paDeliverAgainOne", { name: name }) : `发送一条到 ${name}`;
  }
  return true;
}

/**
 * 将纯文本按当前「转发目标」发出。
 * 任务描述目标：delivered=false（调用方自行写描述）。
 * IDE 目标：剪贴板 + SW deeplink/native，不写任务描述。
 */
async function deliverPlainTextViaDeliveryTarget(text, pageUrl) {
  const target = await loadPageAdvisorDeliveryTarget();
  if (
    typeof PageAdvisorDelivery === "undefined"
    || !PageAdvisorDelivery.isIdeDeliveryTarget
    || !PageAdvisorDelivery.isIdeDeliveryTarget(target)
  ) {
    return { delivered: false, target: target };
  }
  const block = String(text || "");
  let copied = false;
  try {
    const clip = navigator.clipboard && navigator.clipboard.writeText;
    if (clip && block) {
      await clip.call(navigator.clipboard, block);
      copied = true;
    }
  } catch (_) {
    copied = false;
  }
  let deeplinkOk = false;
  let nativeOk = false;
  let nativeError = "";
  try {
    const resp = await chrome.runtime.sendMessage({
      action: "deliverPageAdvisorToIde",
      target: target,
      text: block,
      pageUrl: String(pageUrl || ""),
    });
    deeplinkOk = !!(resp && resp.deeplinkOk);
    nativeOk = !!(resp && resp.nativeOk);
    nativeError = String((resp && (resp.nativeError || resp.error)) || "");
  } catch (_) {
    deeplinkOk = false;
    nativeOk = false;
  }
  const status = PageAdvisorDelivery.formatUserStatus(
    target,
    {
      clipboardOk: copied,
      deeplinkOk: deeplinkOk,
      nativeOk: nativeOk,
      nativeError: nativeError,
    },
    typeof tx === "function" ? tx : null,
  );
  if (typeof showResult === "function") {
    showResult(status.text, status.ok ? "success" : "error");
  } else if (!status.ok && typeof setPageAdvisorError === "function") {
    setPageAdvisorError(status.text);
  }
  return {
    delivered: true,
    target: target,
    ok: status.ok,
    text: status.text,
    createTaskCalled: false,
    openedPanel: false,
  };
}

async function deliverPageAdvisorSuggestions(opts) {
  opts = opts || {};
  const mode = opts.mode === "one" ? "one" : "all";
  let selectedIds = Array.isArray(opts.selectedIds) ? opts.selectedIds.slice() : [];
  if (!selectedIds.length) {
    selectedIds = collectSelectedSuggestionIds();
  }
  if (mode === "one" && selectedIds.length) {
    selectedIds = [selectedIds[0]];
  }
  const Fill = typeof PageAdvisorFill !== "undefined" ? PageAdvisorFill : null;
  if (!Fill || !selectedIds.length) {
    return { filled: false, createTaskCalled: false };
  }
  const ordered = Fill.orderSelectedSuggestions(pageAdvisorState.suggestions, selectedIds);
  const block = Fill.formatSuggestionsBlock(ordered, pageAdvisorState.pageUrl);
  const outcome = await deliverPlainTextViaDeliveryTarget(block, pageAdvisorState.pageUrl);
  if (!outcome.delivered) {
    return { filled: false, createTaskCalled: false };
  }
  return { filled: outcome.ok, createTaskCalled: false, openedPanel: false };
}
