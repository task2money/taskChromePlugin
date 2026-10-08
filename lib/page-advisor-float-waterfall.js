/**
 * 页内采集面板上的环节耗时：与侧栏 waterfall 同源，只在采集卡可见时跳动。
 */
'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {
const PageAdvisorFloatWaterfall = (() => {
  const HOST_ID = 'taskplugin-page-advisor-waterfall';
  let currentRun = null;
  let tickTimer = 0;
  let paintDoc = null;

  function txKey(key) {
    if (typeof tx === 'function') {
      const out = tx(key);
      if (out != null && out !== key) return out;
    }
    return key;
  }

  function hostEl(doc) {
    const d = doc || paintDoc || (typeof document !== 'undefined' ? document : null);
    if (!d || typeof d.getElementById !== 'function') return null;
    return d.getElementById(HOST_ID);
  }

  function stopTick() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = 0;
    }
  }

  function chartHtml() {
    const View = typeof PageAdvisorWaterfallView !== 'undefined' ? PageAdvisorWaterfallView : null;
    if (!View || !currentRun || !Array.isArray(currentRun.spans) || !currentRun.spans.length) return '';
    return View.renderRun(currentRun, txKey);
  }

  function paint(doc) {
    const el = hostEl(doc);
    if (!el) {
      stopTick();
      return;
    }
    const html = chartHtml();
    el.hidden = !html;
    el.innerHTML = html;
  }

  function ensureTick(doc) {
    stopTick();
    if (!currentRun || currentRun.status !== 'running') return;
    if (!hostEl(doc)) return;
    tickTimer = setInterval(() => paint(doc), 250);
    if (tickTimer && typeof tickTimer.unref === 'function') tickTimer.unref();
  }

  function applyRun(run, doc) {
    if (doc) paintDoc = doc;
    currentRun = run || null;
    paint(paintDoc);
    ensureTick(paintDoc);
  }

  function resume(doc) {
    paint(doc);
    ensureTick(doc || paintDoc);
  }

  function pause() { stopTick(); }

  function clear() {
    currentRun = null;
    stopTick();
  }

  function statusCardHtml(text, escFn) {
    const e = typeof escFn === 'function' ? escFn : (s) => String(s ?? '');
    const chart = chartHtml();
    const hidden = chart ? '' : ' hidden';
    return `<div class="taskplugin-page-advisor-status-card">`
      + `<div class="taskplugin-page-advisor-status-text" role="status" aria-live="polite" aria-atomic="true">${e(text)}</div>`
      + `<div id="${HOST_ID}" class="taskplugin-page-advisor-waterfall" data-testid="page-advisor-float-waterfall"${hidden} aria-hidden="true">${chart}</div>`
      + `</div>`;
  }

  function onMessage(msg) {
    if (!msg || msg.action !== 'pageAdvisorWaterfall') return false;
    applyRun(msg.run);
    return true;
  }

  return {
    HOST_ID, applyRun, paint, resume, pause, clear, statusCardHtml, onMessage, chartHtml,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorFloatWaterfall;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorFloatWaterfall = PageAdvisorFloatWaterfall;
}
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage
  && typeof chrome.runtime.onMessage.addListener === 'function') {
  chrome.runtime.onMessage.addListener((msg) => {
    PageAdvisorFloatWaterfall.onMessage(msg);
  });
}
}
