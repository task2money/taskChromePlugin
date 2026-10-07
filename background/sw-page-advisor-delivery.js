/** IDE 送达：L4 deeplink 打开编辑器 + L3 native host 粘贴；失败由 content 降级剪贴板。 */

'use strict';

function sendPageAdvisorNativeMessage(payload) {
  return new Promise((resolve) => {
    try {
      if (!chrome.runtime || typeof chrome.runtime.sendNativeMessage !== 'function') {
        resolve({ nativeOk: false, error: 'native_unavailable' });
        return;
      }
      const host =
        (typeof PageAdvisorDelivery !== 'undefined' && PageAdvisorDelivery.NATIVE_HOST)
          || 'com.aidevpush.ide_bridge';
      chrome.runtime.sendNativeMessage(host, payload, (resp) => {
        const last = chrome.runtime.lastError;
        if (last) {
          resolve({ nativeOk: false, error: last.message || 'host_missing' });
          return;
        }
        resolve({
          nativeOk: !!(resp && resp.ok),
          method: resp && resp.method,
          nativeError: resp && resp.error,
        });
      });
    } catch (e) {
      resolve({ nativeOk: false, error: e && e.message ? e.message : String(e) });
    }
  });
}

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

async function handleDeliverPageAdvisorToIde(message) {
  const target =
    typeof PageAdvisorDelivery !== 'undefined'
      ? PageAdvisorDelivery.normalizeTarget(message && message.target)
      : 'task_description';
  if (target === 'task_description') {
    return { success: true, nativeOk: false, deeplinkOk: false };
  }
  const text = String((message && message.text) || '');
  const pageUrl = String((message && message.pageUrl) || '');
  const deeplink =
    typeof PageAdvisorDelivery !== 'undefined'
    && typeof PageAdvisorDelivery.buildIdeDeeplink === 'function'
      ? PageAdvisorDelivery.buildIdeDeeplink(target, text)
      : '';

  // L4 优先：用官方/登记深链真正打开编辑器并预填（Cursor/Claude/Codex）
  const open = await openPageAdvisorIdeDeeplink(deeplink);

  // L3 可选：本机桥聚焦并粘贴（未装 host 时静默失败）
  const native = await sendPageAdvisorNativeMessage({
    target: target,
    text: text,
    pageUrl: pageUrl,
  });

  return {
    success: true,
    deeplinkOk: !!open.deeplinkOk,
    deeplinkError: open.error || '',
    deeplinkUrl: deeplink ? deeplink.slice(0, 120) : '',
    nativeOk: !!native.nativeOk,
    method: native.method || (open.deeplinkOk ? 'deeplink' : ''),
    nativeError: native.nativeError || native.error || '',
  };
}
