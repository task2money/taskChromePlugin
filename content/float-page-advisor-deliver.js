/**
 * IDE 送达：剪贴板 + SW deeplink/native；生成成功后自动转发一次。
 * 亦供 Alt+X 元素调整块按同一渠道发送。
 */

"use strict";

var pageAdvisorDeliveryTargetCache = "task_description";
var pageAdvisorAutoDeliveredJobs = Object.create(null);

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
    || !PageAdvisorDelivery.shouldAutoDeliverOnResult(t)
  ) {
    return false;
  }
  const name = PageAdvisorDelivery.ideDisplayName(t, typeof tx === "function" ? tx : null);
  if (allBtn) {
    allBtn.textContent =
      typeof tx === "function" ? tx("paDeliverAgainAll", { name: name }) : `再次发送到 ${name}`;
  }
  if (oneBtn) {
    oneBtn.textContent =
      typeof tx === "function" ? tx("paDeliverAgainOne", { name: name }) : `再发一条到 ${name}`;
  }
  return true;
}

/**
 * 将纯文本按当前「建议送达」目标发出。
 * 任务描述目标：delivered=false（调用方自行写描述）。
 * IDE 目标：剪贴板 + SW deeplink/native，不写任务描述。
 */
async function deliverPlainTextViaDeliveryTarget(text, pageUrl) {
  const target = await loadPageAdvisorDeliveryTarget();
  if (
    typeof PageAdvisorDelivery === "undefined"
    || !PageAdvisorDelivery.shouldAutoDeliverOnResult(target)
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

async function maybeAutoDeliverPageAdvisorResult(payload) {
  const suggestions = Array.isArray(payload && payload.suggestions) ? payload.suggestions : [];
  if (!suggestions.length) return;
  const jobId = String((payload && payload.jobId) || "");
  const target = await loadPageAdvisorDeliveryTarget();
  if (!PageAdvisorDelivery.shouldAutoDeliverOnResult(target)) return;
  if (jobId && pageAdvisorAutoDeliveredJobs[jobId]) return;
  if (jobId) pageAdvisorAutoDeliveredJobs[jobId] = 1;
  const ids = suggestions.map((s) => String(s.id != null ? s.id : "")).filter(Boolean);
  await deliverPageAdvisorSuggestions({ mode: "all", selectedIds: ids, auto: true });
}
