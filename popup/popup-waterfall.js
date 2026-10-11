/**
 * 侧栏设置不再绘制环节耗时条。仍接收 waterfall 消息，记下本机模型最近一次成功耗时。
 */
'use strict';

const PageAdvisorWaterfallPopup = (() => {
  let mountedDoc = null;

  function localStorageArea() {
    return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
  }

  function refreshBuiltinRouteLabel() {
    const mod = globalThis.PageAdvisorBuiltinLastRun;
    if (!mod || !mountedDoc || typeof mountedDoc.querySelector !== 'function') return;
    const el = mountedDoc.querySelector('[data-i18n="paLlmRouteBuiltin"]');
    if (!el) return;
    mod.readBuiltinLastMs(localStorageArea())
      .then((ms) => { el.textContent = mod.builtinRouteLabel(txKey, ms); })
      .catch(() => { /* ignore */ });
  }

  function recordBuiltinRun(run) {
    const mod = globalThis.PageAdvisorBuiltinLastRun;
    if (!mod || typeof mod.recordBuiltinRun !== 'function') return Promise.resolve(0);
    return mod.recordBuiltinRun(localStorageArea(), run)
      .then((ms) => {
        if (ms) refreshBuiltinRouteLabel();
        return ms;
      })
      .catch(() => 0);
  }

  function isSidepanel(doc) {
    const el = doc && doc.documentElement;
    return !!(el && el.getAttribute && el.getAttribute('data-taskplugin-host') === 'sidepanel');
  }

  function txKey(key) {
    if (typeof tx === 'function') return tx(key);
    return key;
  }

  function applyRun(run) {
    return recordBuiltinRun(run);
  }

  function mount(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !isSidepanel(d)) {
      mountedDoc = null;
      return null;
    }
    mountedDoc = d;
    refreshBuiltinRouteLabel();
    return null;
  }

  function onRuntimeMessage(msg) {
    if (!msg || msg.action !== 'pageAdvisorWaterfall') return;
    applyRun(msg.run);
  }

  function bindRuntime(runtime) {
    const rt = runtime || (typeof chrome !== 'undefined' ? chrome.runtime : null);
    if (!rt || !rt.onMessage || typeof rt.onMessage.addListener !== 'function') return;
    rt.onMessage.addListener(onRuntimeMessage);
  }

  async function restoreFromSession(session) {
    const store = session || (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session);
    if (!store || typeof store.get !== 'function') return;
    try {
      const got = await store.get(['pageAdvisorWaterfallCurrent']);
      if (got && got.pageAdvisorWaterfallCurrent) await applyRun(got.pageAdvisorWaterfallCurrent);
    } catch (_) { /* ignore */ }
  }

  function boot(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !isSidepanel(d)) return null;
    mount(d);
    bindRuntime();
    restoreFromSession();
    return null;
  }

  return {
    isSidepanel,
    mount,
    applyRun,
    onRuntimeMessage,
    bindRuntime,
    restoreFromSession,
    boot,
    refreshBuiltinRouteLabel,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorWaterfallPopup;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorWaterfallPopup = PageAdvisorWaterfallPopup;
}
if (typeof document !== 'undefined') {
  PageAdvisorWaterfallPopup.boot(document);
}
