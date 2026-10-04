/**
 * Side Panel 自动创新 waterfall：仅 data-taskplugin-host=sidepanel 挂载。
 */
'use strict';

const PageAdvisorWaterfallPopup = (() => {
  let root = null;
  let tickTimer = 0;
  let currentRun = null;

  function isSidepanel(doc) {
    const el = doc && doc.documentElement;
    return !!(el && el.getAttribute && el.getAttribute('data-taskplugin-host') === 'sidepanel');
  }

  function txKey(key) {
    if (typeof tx === 'function') return tx(key);
    return key;
  }

  function stopTick() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = 0;
    }
  }

  function paint() {
    if (!root || typeof PageAdvisorWaterfallView === 'undefined') return;
    const html = currentRun
      ? PageAdvisorWaterfallView.renderRun(currentRun, txKey)
      : PageAdvisorWaterfallView.renderIdle(txKey);
    root.innerHTML = html;
  }

  function applyRun(run) {
    currentRun = run || null;
    paint();
    stopTick();
    if (currentRun && currentRun.status === 'running') {
      tickTimer = setInterval(paint, 250);
    }
  }

  function mount(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !isSidepanel(d)) return null;
    const section = d.getElementById('pageAdvisorLlmSection');
    if (!section) return null;
    let el = d.getElementById('pageAdvisorWaterfall');
    if (!el) {
      el = d.createElement('div');
      el.id = 'pageAdvisorWaterfall';
      el.className = 'page-advisor-waterfall';
      el.setAttribute('data-testid', 'page-advisor-waterfall');
      section.appendChild(el);
    }
    el.hidden = false;
    root = el;
    paint();
    return el;
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
      if (got && got.pageAdvisorWaterfallCurrent) applyRun(got.pageAdvisorWaterfallCurrent);
    } catch (_) { /* ignore */ }
  }

  function boot(doc) {
    const el = mount(doc);
    if (!el) return null;
    bindRuntime();
    restoreFromSession();
    return el;
  }

  return { isSidepanel, mount, applyRun, onRuntimeMessage, bindRuntime, restoreFromSession, boot };
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
