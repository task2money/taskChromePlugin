/** Native host 送达 Cursor/Claude/Codex（L3）；失败由 content 降级剪贴板。 */

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

async function handleDeliverPageAdvisorToIde(message) {
  const target =
    typeof PageAdvisorDelivery !== 'undefined'
      ? PageAdvisorDelivery.normalizeTarget(message && message.target)
      : 'task_description';
  if (target === 'task_description') {
    return { success: true, nativeOk: false };
  }
  const payload = {
    target: target,
    text: String((message && message.text) || ''),
    pageUrl: String((message && message.pageUrl) || ''),
  };
  const native = await sendPageAdvisorNativeMessage(payload);
  return {
    success: true,
    nativeOk: !!native.nativeOk,
    method: native.method,
    nativeError: native.nativeError || native.error || '',
  };
}
