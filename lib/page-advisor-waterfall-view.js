/**
 * Waterfall DOM 纯函数：Side Panel 智能体区块底部条带。
 */
'use strict';

const PageAdvisorWaterfallView = (() => {
  const LABEL_KEYS = {
    capture: 'paWfCapture',
    prompt: 'paWfPrompt',
    network: 'paWfNetwork',
    network_wait: 'paWfNetworkWait',
    network_download: 'paWfNetworkDownload',
    llm_wait: 'paWfLlmWait',
    saas_poll: 'paWfSaasPoll',
    saas_fwd_queue: 'paWfSaasFwdQueue',
    saas_fwd_send: 'paWfSaasFwdSend',
    saas_fwd_wait: 'paWfSaasFwdWait',
    saas_fwd_recv: 'paWfSaasFwdRecv',
    builtin: 'paWfBuiltin',
    builtin_probe: 'paWfBuiltinProbe',
    builtin_create: 'paWfBuiltinCreate',
    builtin_fit: 'paWfBuiltinFit',
    builtin_infer: 'paWfBuiltinInfer',
    builtin_parse: 'paWfBuiltinParse',
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

  function formatSpanMs(bar, t) {
    if (!bar) return formatMs(0);
    if (bar.status === 'pending' || bar.status === 'skipped') {
      const label = typeof t === 'function' ? t('paWfPendingMs') : '—';
      return (!label || label === 'paWfPendingMs') ? '—' : label;
    }
    const base = formatMs(bar.durationMs);
    return bar.detail ? `${base} · ${bar.detail}` : base;
  }

  function renderIdle(tx) {
    const t = typeof tx === 'function' ? tx : (k) => k;
    return `<p class="pa-wf-idle" data-i18n="paWfIdle">${esc(t('paWfIdle'))}</p>`;
  }

  /**
   * OPT-20261005-004: 「本机模型」Tab 专用提示。
   * 本次运行并非本机模型（route 非 builtin）时，先说明这次走直连/平台，
   * 避免用户把同一条 waterfall 误读为本机推理。
   */
  function renderRouteNotice(tx, route) {
    if (!route || route === 'builtin') return '';
    const t = typeof tx === 'function' ? tx : (k) => k;
    return `<p class="pa-wf-route-notice" data-i18n="paWfBuiltinRouteNotice">${esc(t('paWfBuiltinRouteNotice'))}</p>`;
  }

  function renderRun(run, tx, layoutBars, opts) {
    const t = typeof tx === 'function' ? tx : (k) => k;
    const options = opts || {};
    if (!run || !Array.isArray(run.spans) || !run.spans.length) return renderIdle(t);
    const allBars = typeof layoutBars === 'function'
      ? layoutBars(run)
      : (globalThis.PageAdvisorTiming && PageAdvisorTiming.layoutBars(run)) || [];
    // OPT-20261005-003: 成功结束时默认隐藏未跑到的 skipped 细项，减少视觉噪音；
    // 有跳过项时给一个切换按钮，用户可随时展开。
    const skippedCount = allBars.filter((b) => b.status === 'skipped').length;
    const bars = options.hideSkipped ? allBars.filter((b) => b.status !== 'skipped') : allBars;
    const total = run.endedAt != null
      ? Math.max(0, run.endedAt - run.startedAt)
      : Math.max(0, Date.now() - (Number(run.startedAt) || 0));
    const statusKey = run.status === 'error' ? 'paWfStatusError'
      : run.status === 'ok' ? 'paWfStatusOk' : 'paWfStatusRunning';
    const rows = bars.map((b) => {
      const label = t(LABEL_KEYS[b.id] || b.id);
      const left = Math.max(0, Math.min(100, b.leftPct || 0));
      const isIdleBar = b.status === 'pending' || b.status === 'skipped';
      const width = isIdleBar
        ? 0
        : Math.max(0.4, Math.min(100 - left, b.widthPct || 0));
      return `<div class="pa-wf-row" data-span="${esc(b.id)}" data-span-status="${esc(b.status || 'ok')}">
        <span class="pa-wf-label">${esc(label)}</span>
        <div class="pa-wf-track"><span class="pa-wf-bar pa-wf-bar-${esc(b.id)} pa-wf-bar-${esc(b.status || 'ok')}"
          style="left:${left}%;width:${width}%"></span></div>
        <span class="pa-wf-ms">${esc(formatSpanMs(b, t))}</span>
      </div>`;
    }).join('');
    const toggle = skippedCount > 0
      ? `<button type="button" class="pa-wf-toggle-skipped" data-pa-wf-toggle="skipped" data-testid="pa-wf-toggle-skipped"
          data-i18n="${options.hideSkipped ? 'paWfShowSkipped' : 'paWfHideSkipped'}"
        >${esc(t(options.hideSkipped ? 'paWfShowSkipped' : 'paWfHideSkipped'))}（${skippedCount}）</button>`
      : '';
    return `<div class="pa-wf-head" aria-live="polite">
      <span data-i18n="${statusKey}">${esc(t(statusKey))}</span>
      <span class="pa-wf-total">${esc(formatMs(total))}</span>
      ${toggle}
    </div>
    <div class="pa-wf-rows">${rows}</div>`;
  }

  return { LABEL_KEYS, esc, formatMs, formatSpanMs, renderIdle, renderRouteNotice, renderRun };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorWaterfallView;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorWaterfallView = PageAdvisorWaterfallView;
}
