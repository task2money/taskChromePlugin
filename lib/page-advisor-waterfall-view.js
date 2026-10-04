/**
 * Waterfall DOM 纯函数：Side Panel 智能体区块底部条带。
 */
'use strict';

const PageAdvisorWaterfallView = (() => {
  const LABEL_KEYS = {
    capture: 'paWfCapture',
    prompt: 'paWfPrompt',
    network: 'paWfNetwork',
    llm_wait: 'paWfLlmWait',
    saas_poll: 'paWfSaasPoll',
    builtin: 'paWfBuiltin',
    parse: 'paWfParse',
    render: 'paWfRender',
  };

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMs(ms) {
    const n = Number(ms) || 0;
    if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
    return `${Math.round(n)}ms`;
  }

  function renderIdle(tx) {
    const t = typeof tx === 'function' ? tx : (k) => k;
    return `<p class="pa-wf-idle" data-i18n="paWfIdle">${esc(t('paWfIdle'))}</p>`;
  }

  function renderRun(run, tx, layoutBars) {
    const t = typeof tx === 'function' ? tx : (k) => k;
    if (!run || !Array.isArray(run.spans) || !run.spans.length) return renderIdle(t);
    const bars = typeof layoutBars === 'function'
      ? layoutBars(run)
      : (globalThis.PageAdvisorTiming && PageAdvisorTiming.layoutBars(run)) || [];
    const total = run.endedAt != null
      ? Math.max(0, run.endedAt - run.startedAt)
      : Math.max(0, Date.now() - (Number(run.startedAt) || 0));
    const statusKey = run.status === 'error' ? 'paWfStatusError'
      : run.status === 'ok' ? 'paWfStatusOk' : 'paWfStatusRunning';
    const rows = bars.map((b) => {
      const label = t(LABEL_KEYS[b.id] || b.id);
      const left = Math.max(0, Math.min(100, b.leftPct || 0));
      const width = Math.max(0.4, Math.min(100 - left, b.widthPct || 0));
      return `<div class="pa-wf-row" data-span="${esc(b.id)}">
        <span class="pa-wf-label">${esc(label)}</span>
        <div class="pa-wf-track"><span class="pa-wf-bar pa-wf-bar-${esc(b.id)} pa-wf-bar-${esc(b.status || 'ok')}"
          style="left:${left}%;width:${width}%"></span></div>
        <span class="pa-wf-ms">${esc(formatMs(b.durationMs))}</span>
      </div>`;
    }).join('');
    return `<div class="pa-wf-head" aria-live="polite">
      <span data-i18n="${statusKey}">${esc(t(statusKey))}</span>
      <span class="pa-wf-total">${esc(formatMs(total))}</span>
    </div>
    <div class="pa-wf-rows">${rows}</div>`;
  }

  return { LABEL_KEYS, esc, formatMs, renderIdle, renderRun };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorWaterfallView;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorWaterfallView = PageAdvisorWaterfallView;
}
