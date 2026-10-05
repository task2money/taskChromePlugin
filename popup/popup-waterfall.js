/**
 * Side Panel 自动创新 waterfall：设置 iframe 与「本机模型」Tab 同步挂载。
 */
'use strict';

const PageAdvisorWaterfallPopup = (() => {
  const SLOTS = Object.freeze([
    { id: 'pageAdvisorWaterfall', parentId: 'pageAdvisorLlmSection' },
    { id: 'pageAdvisorWaterfallBuiltin', parentId: 'spBuiltinPanel' },
  ]);

  let roots = [];
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
    if (!roots.length || typeof PageAdvisorWaterfallView === 'undefined') return;
    const html = currentRun
      ? PageAdvisorWaterfallView.renderRun(currentRun, txKey)
      : PageAdvisorWaterfallView.renderIdle(txKey);
    roots.forEach((el) => { el.innerHTML = html; });
  }

  function applyRun(run) {
    currentRun = run || null;
    paint();
    stopTick();
    if (currentRun && currentRun.status === 'running') {
      tickTimer = setInterval(paint, 250);
    }
  }

  function ensureSlot(d, spec) {
    const parent = d.getElementById(spec.parentId);
    if (!parent) return null;
    let el = d.getElementById(spec.id);
    if (!el) {
      el = d.createElement('div');
      el.id = spec.id;
      el.className = 'page-advisor-waterfall';
      el.setAttribute('data-testid', spec.id === 'pageAdvisorWaterfallBuiltin'
        ? 'page-advisor-waterfall-builtin'
        : 'page-advisor-waterfall');
      parent.appendChild(el);
    }
    el.hidden = false;
    return el;
  }

  function mount(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !isSidepanel(d)) {
      roots = [];
      return null;
    }
    roots = SLOTS.map((spec) => ensureSlot(d, spec)).filter(Boolean);
    if (!roots.length) return null;
    paint();
    return roots[0];
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

  return { isSidepanel, mount, applyRun, onRuntimeMessage, bindRuntime, restoreFromSession, boot, SLOTS };
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
