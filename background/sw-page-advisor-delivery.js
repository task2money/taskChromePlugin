/** IDE 送达：官方深链打开编辑器。超限时按建议分批各开一条。 */

'use strict';

async function persistPageAdvisorDeliveryTarget(message) {
  const Delivery = globalThis.PageAdvisorDelivery;
  if (!Delivery || typeof Delivery.preferencePayload !== 'function') {
    return { success: false, error: 'delivery_unavailable' };
  }
  const payload = Delivery.preferencePayload(message && message.target, message && message.at);
  await chrome.storage.local.set(payload);
  console.info('[taskChromePlugin] delivery preference saved', {
    target: payload.pageAdvisorDeliveryTarget,
    at: payload.pageAdvisorDeliveryTargetAt,
  });
  return { success: true };
}

/** 同一轮点击连续打开多条协议链接的间隔，避免系统只收下最后一条。不是轮询。 */
var PAGE_ADVISOR_BATCH_OPEN_GAP_MS = 200;

function openPageAdvisorIdeDeeplink(url) {
  return new Promise((resolve) => {
    const href = String(url || '').trim();
    if (!href) {
      resolve({ deeplinkOk: false, error: 'no_deeplink' });
      return;
    }
    try {
      if (!chrome.tabs || typeof chrome.tabs.create !== 'function') {
        resolve({ deeplinkOk: false, error: 'tabs_unavailable' });
        return;
      }
      // Anti-Replay-OK: OS protocol handoff; no write API — opens IDE via registered scheme
      chrome.tabs.create({ url: href, active: true }, () => {
        const last = chrome.runtime.lastError;
        if (last) {
          resolve({ deeplinkOk: false, error: last.message || 'tabs_create_failed' });
          return;
        }
        resolve({ deeplinkOk: true });
      });
    } catch (e) {
      resolve({ deeplinkOk: false, error: e && e.message ? e.message : String(e) });
    }
  });
}

function waitPageAdvisorBatchGap() {
  return new Promise((resolve) => {
    setTimeout(resolve, PAGE_ADVISOR_BATCH_OPEN_GAP_MS);
  });
}

function logPageAdvisorIdeDeliver(fields) {
  try {
    console.info(JSON.stringify(Object.assign({
      level: 'info',
      msg: 'page_advisor_ide_deliver',
    }, fields)));
  } catch (_) {
    /* 日志失败不影响送达 */
  }
}

async function handleDeliverPageAdvisorToIde(message) {
  const Delivery = typeof PageAdvisorDelivery !== 'undefined' ? PageAdvisorDelivery : null;
  const target = Delivery
    ? Delivery.normalizeTarget(message && message.target)
    : 'task_description';
  if (target === 'task_description') {
    return { success: true, deeplinkOk: false, batchCount: 0 };
  }
  const text = String((message && message.text) || '');
  const pageUrl = String((message && message.pageUrl) || '');
  if (!text || !Delivery || typeof Delivery.buildIdeDeeplinkBatches !== 'function') {
    return { success: true, deeplinkOk: false, deeplinkError: 'no_deeplink', batchCount: 0 };
  }
  const batches = Delivery.buildIdeDeeplinkBatches(target, text, pageUrl);
  const opened = [];
  for (let i = 0; i < batches.length; i++) {
    const url = Delivery.buildIdeDeeplink(target, batches[i]);
    if (!url) {
      logPageAdvisorIdeDeliver({
        target: target,
        handoff: 'batch',
        overflow: true,
        textChars: text.length,
        batchCount: opened.length,
        deeplinkOk: false,
      });
      return {
        success: true,
        deeplinkOk: false,
        deeplinkError: 'url_too_long',
        batchCount: opened.length,
        overflow: true,
      };
    }
    const open = await openPageAdvisorIdeDeeplink(url);
    if (!open.deeplinkOk) {
      logPageAdvisorIdeDeliver({
        target: target,
        handoff: 'batch',
        overflow: batches.length > 1,
        textChars: text.length,
        batchCount: opened.length,
        deeplinkOk: false,
      });
      return {
        success: true,
        deeplinkOk: false,
        deeplinkError: open.error || 'tabs_create_failed',
        batchCount: opened.length,
        overflow: batches.length > 1,
      };
    }
    opened.push(url.length);
    if (i + 1 < batches.length) await waitPageAdvisorBatchGap();
  }
  logPageAdvisorIdeDeliver({
    target: target,
    handoff: opened.length > 1 ? 'batch' : 'inline',
    overflow: opened.length > 1,
    textChars: text.length,
    batchCount: opened.length,
    deeplinkChars: opened.length ? Math.max.apply(null, opened) : 0,
    deeplinkOk: opened.length > 0,
  });
  return {
    success: true,
    deeplinkOk: opened.length > 0,
    batchCount: opened.length,
    overflow: opened.length > 1,
    deeplinkError: opened.length ? '' : 'no_deeplink',
  };
}
