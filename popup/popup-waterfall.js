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
  let mountedDoc = null;
  // OPT-20261005-003: 成功运行的 skipped 细项默认折叠，点击切换展开。
  let showSkipped = false;

  function localStorageArea() {
    return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
  }

  /**
   * OPT-20261005-005: 用本机最近一次 builtin 成功耗时刷新「本机模型」标题；
   * 无实测数据时保持静态文案（由 PageAdvisorBuiltinLastRun 决定回退）。
   */
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
    if (!mod || typeof mod.recordBuiltinRun !== 'function') return;
    mod.recordBuiltinRun(localStorageArea(), run)
      .then((ms) => { if (ms) refreshBuiltinRouteLabel(); })
      .catch(() => { /* ignore */ });
  }

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

  function renderFor(rootId) {
    if (!currentRun) return PageAdvisorWaterfallView.renderIdle(txKey);
    const hideSkipped = currentRun.status === 'ok' && !showSkipped;
    const body = PageAdvisorWaterfallView.renderRun(currentRun, txKey, undefined, { hideSkipped });
    // OPT-20261005-004: 仅「本机模型」Tab 在非 builtin 路由时加一行说明。
    if (rootId === 'pageAdvisorWaterfallBuiltin') {
      return PageAdvisorWaterfallView.renderRouteNotice(txKey, currentRun.route) + body;
    }
    return body;
  }

  function paint() {
    if (!roots.length || typeof PageAdvisorWaterfallView === 'undefined') return;
    roots.forEach((el) => { el.innerHTML = renderFor(el.id); });
  }

  function onRootClick(event) {
    const target = event && event.target;
    const toggle = target && typeof target.closest === 'function'
      ? target.closest('[data-pa-wf-toggle]')
      : null;
    if (!toggle) return;
    showSkipped = !showSkipped;
    paint();
  }

  function bindRootEvents(el) {
    if (el && typeof el.addEventListener === 'function') {
      el.addEventListener('click', onRootClick);
    }
  }

  function applyRun(run) {
    currentRun = run || null;
    showSkipped = false;
    paint();
    recordBuiltinRun(currentRun);
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
    if (!el.__paWfClickBound) {
      bindRootEvents(el);
      el.__paWfClickBound = true;
    }
    return el;
  }

  function mount(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !isSidepanel(d)) {
      roots = [];
      return null;
    }
    mountedDoc = d;
    roots = SLOTS.map((spec) => ensureSlot(d, spec)).filter(Boolean);
    if (!roots.length) return null;
    paint();
    refreshBuiltinRouteLabel();
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

  return {
    isSidepanel, mount, applyRun, onRuntimeMessage, bindRuntime, restoreFromSession, boot, SLOTS,
    onRootClick, refreshBuiltinRouteLabel,
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
