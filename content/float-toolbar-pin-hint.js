/**
 * 浮窗 boot 后问一次工具栏是否已固定。未固定且用户未关闭过时展示提示。
 * 不轮询，不写入固定状态。读取经 service worker 的 getToolbarPin。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(async function showToolbarPinPageHintOnce() {
  if (typeof __taskpluginFloatSkip !== 'undefined' && __taskpluginFloatSkip) return;
  if (typeof __taskpluginOnAuthRoute !== 'undefined' && __taskpluginOnAuthRoute) return;
  var box = document.getElementById('taskplugin-toolbar-pin-hint');
  var hintApi = globalThis.ToolbarPinHint;
  if (!box || !hintApi || typeof sendMessageWithTimeout !== 'function') return;
  var key = hintApi.TOOLBAR_PIN_PAGE_HINT_DISMISSED_KEY;
  var dismissed = false;
  try {
    var stored = await chrome.storage.local.get(key);
    dismissed = !!(stored && stored[key]);
  } catch (_) {
    return;
  }
  if (dismissed) return;
  var res = null;
  try {
    res = await sendMessageWithTimeout({ action: 'getToolbarPin' }, 5000);
  } catch (_) {
    return;
  }
  var data = res && res.success ? res.data : null;
  var show = hintApi.shouldShowToolbarPinPageHint({
    known: !!(data && data.known),
    pinned: !!(data && data.pinned),
    dismissed: false,
  });
  if (!show) return;
  box.hidden = false;
  var closeBtn = document.getElementById('taskplugin-toolbar-pin-hint-close');
  if (!closeBtn) return;
  // Anti-Replay-OK: local dismiss only; no HTTP write
  closeBtn.addEventListener('click', function () {
    if (closeBtn.disabled) return;
    closeBtn.disabled = true;
    box.hidden = true;
    var payload = {};
    payload[key] = true;
    chrome.storage.local.set(payload);
  });
})();
}
