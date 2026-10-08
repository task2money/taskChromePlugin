/**
 * 页内采集面板上的环节耗时：与侧栏 waterfall 同源，只在采集卡可见时跳动。
 */
'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {
const PageAdvisorFloatWaterfall = (() => {
  const HOST_ID = 'taskplugin-page-advisor-waterfall';
  const ANNOUNCE_ID = 'taskplugin-page-advisor-waterfall-announce';
  const ANNOUNCE_INTERVAL_MS = 5000;
  let currentRun = null;
  let tickTimer = 0;
  let paintDoc = null;
  let lastAnnounceStageKey = '';
  let lastAnnounceAt = 0;

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

  function announceHost(doc) {
    const d = doc || paintDoc || (typeof document !== 'undefined' ? document : null);
    if (!d || typeof d.getElementById !== 'function') return null;
    return d.getElementById(ANNOUNCE_ID);
  }

  /** 当前进行中的环节；都结束后取最后一个环节。 */
  function currentSpan(run) {
    if (!run || !Array.isArray(run.spans) || !run.spans.length) return null;
    let running = null;
    for (let i = 0; i < run.spans.length; i++) {
      const s = run.spans[i];
      if (s && s.status === 'running') running = s;
    }
    return running || run.spans[run.spans.length - 1] || null;
  }

  function stageLabel(span) {
    if (!span) return '';
    const View = typeof PageAdvisorWaterfallView !== 'undefined' ? PageAdvisorWaterfallView : null;
    const key = View && View.LABEL_KEYS && View.LABEL_KEYS[span.id]
      ? View.LABEL_KEYS[span.id]
      : String(span.id || '');
    return txKey(key);
  }

  /** 环节名 + 已用秒数；i18n 缺失时退回「环节 12s」（无 CJK，避免漏译）。 */
  function announceText(span) {
    const stage = stageLabel(span);
    if (!stage || !currentRun || currentRun.startedAt == null) return '';
    const endRef = currentRun.endedAt != null ? currentRun.endedAt : Date.now();
    const seconds = Math.max(0, Math.round((endRef - currentRun.startedAt) / 1000));
    if (typeof tx === 'function') {
      const out = tx('paWfAnnounce', { stage: stage, seconds: String(seconds) });
      if (out != null && out !== '' && out !== 'paWfAnnounce') return out;
    }
    return stage + ' ' + seconds + 's';
  }

  /**
   * 低频播报（环节切换 / 约每 5 秒），不随 250ms 重绘刷屏；
   * 图表仍在 aria-hidden 内，读屏只能听这条摘要。
   */
  function maybeAnnounce(doc) {
    if (!currentRun || currentRun.status !== 'running') return;
    const el = announceHost(doc);
    if (!el) return;
    const span = currentSpan(currentRun);
    if (!span) return;
    const key = String(span.id || '');
    const now = Date.now();
    if (key === lastAnnounceStageKey && (now - lastAnnounceAt) < ANNOUNCE_INTERVAL_MS) return;
    const text = announceText(span);
    if (!text) return;
    lastAnnounceStageKey = key;
    lastAnnounceAt = now;
    el.textContent = text;
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
    maybeAnnounce(doc);
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
    lastAnnounceStageKey = '';
    lastAnnounceAt = 0;
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
    lastAnnounceStageKey = '';
    lastAnnounceAt = 0;
    stopTick();
  }

  function statusCardHtml(text, escFn) {
    const e = typeof escFn === 'function' ? escFn : (s) => String(s ?? '');
    const chart = chartHtml();
    const hidden = chart ? '' : ' hidden';
    return `<div class="taskplugin-page-advisor-status-card">`
      + `<div class="taskplugin-page-advisor-status-text" role="status" aria-live="polite" aria-atomic="true">${e(text)}</div>`
      + `<div id="${ANNOUNCE_ID}" class="taskplugin-page-advisor-status-announce" role="status" aria-live="polite" aria-atomic="true"></div>`
      + `<div id="${HOST_ID}" class="taskplugin-page-advisor-waterfall" data-testid="page-advisor-float-waterfall"${hidden} aria-hidden="true">${chart}</div>`
      + `</div>`;
  }

  function onMessage(msg) {
    if (!msg || msg.action !== 'pageAdvisorWaterfall') return false;
    applyRun(msg.run);
    return true;
  }

  return {
    HOST_ID, ANNOUNCE_ID, applyRun, paint, resume, pause, clear, statusCardHtml, onMessage,
    chartHtml, maybeAnnounce,
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
