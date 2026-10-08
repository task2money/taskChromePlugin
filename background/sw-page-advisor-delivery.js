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
          promptPath: resp && resp.promptPath ? String(resp.promptPath) : '',
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

function ideDeliverResult(open, native, extra) {
  const deeplink = extra.deeplink || '';
  return {
    success: true,
    overflow: !!extra.overflow,
    promptPath: extra.promptPath || '',
    handoff: extra.handoff || '',
    deeplinkOk: !!open.deeplinkOk,
    deeplinkError: open.error || extra.deeplinkError || '',
    deeplinkUrl: deeplink ? deeplink.slice(0, 120) : '',
    nativeOk: !!native.nativeOk,
    method: native.method || (open.deeplinkOk ? 'deeplink' : ''),
    nativeError: native.nativeError || native.error || '',
  };
}

async function handleDeliverPageAdvisorToIde(message) {
  const Delivery = typeof PageAdvisorDelivery !== 'undefined' ? PageAdvisorDelivery : null;
  const target = Delivery
    ? Delivery.normalizeTarget(message && message.target)
    : 'task_description';
  if (target === 'task_description') {
    return { success: true, nativeOk: false, deeplinkOk: false };
  }
  const text = String((message && message.text) || '');
  const pageUrl = String((message && message.pageUrl) || '');
  const inline = Delivery && typeof Delivery.buildIdeDeeplink === 'function'
    ? Delivery.buildIdeDeeplink(target, text)
    : '';

  if (inline) {
    // L4：全文放得进官方深链时直接预填（Cursor/Claude/Codex）
    const open = await openPageAdvisorIdeDeeplink(inline);
    // L3 可选：本机桥聚焦并粘贴（未装 host 时静默失败）
    const native = await sendPageAdvisorNativeMessage({
      target: target,
      text: text,
      pageUrl: pageUrl,
    });
    logPageAdvisorIdeDeliver({
      target: target,
      handoff: 'inline',
      overflow: false,
      textChars: text.length,
      deeplinkChars: inline.length,
      deeplinkOk: !!open.deeplinkOk,
    });
    return ideDeliverResult(open, native, {
      deeplink: inline,
      overflow: false,
      handoff: 'inline',
    });
  }

  if (!text) {
    const open = { deeplinkOk: false, error: 'no_deeplink' };
    const native = await sendPageAdvisorNativeMessage({
      target: target,
      text: text,
      pageUrl: pageUrl,
    });
    return ideDeliverResult(open, native, { handoff: 'empty', deeplinkError: 'no_deeplink' });
  }

  // 超限：先把全文写入本机文件，深链只带路径。禁止打开被截断的正文。
  const native = await sendPageAdvisorNativeMessage({
    target: target,
    text: text,
    pageUrl: pageUrl,
    materialize: true,
    paste: false,
  });
  const promptPath = String(native.promptPath || '');
  const handoffUrl = promptPath && Delivery && typeof Delivery.buildFileHandoffDeeplink === 'function'
    ? Delivery.buildFileHandoffDeeplink(target, promptPath, pageUrl)
    : '';
  const open = await openPageAdvisorIdeDeeplink(handoffUrl);
  logPageAdvisorIdeDeliver({
    target: target,
    handoff: promptPath && open.deeplinkOk ? 'file' : 'clipboard',
    overflow: true,
    textChars: text.length,
    deeplinkChars: handoffUrl.length,
    deeplinkOk: !!open.deeplinkOk,
  });
  return ideDeliverResult(open, native, {
    deeplink: handoffUrl,
    overflow: true,
    promptPath: promptPath,
    handoff: promptPath && open.deeplinkOk ? 'file' : 'clipboard',
    deeplinkError: handoffUrl ? '' : 'url_too_long',
  });
}
