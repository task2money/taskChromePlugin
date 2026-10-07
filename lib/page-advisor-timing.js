/**
 * Alt+Z / Alt+Shift+Z 本机耗时 run/span。不含密钥与页面正文。
 */
'use strict';

const PageAdvisorTiming = (() => {
  const MAX_HISTORY = 5;
  const SPAN_IDS = Object.freeze([
    'capture', 'prompt', 'network', 'network_wait', 'network_download',
    'llm_wait', 'saas_poll',
    'saas_fwd_queue', 'saas_fwd_send', 'saas_fwd_wait', 'saas_fwd_recv',
    'builtin',
    'builtin_probe', 'builtin_create', 'builtin_fit', 'builtin_infer', 'builtin_parse',
    'parse', 'render',
  ]);

  function defaultNow() {
    return Date.now();
  }

  function createRun(opts) {
    const now = opts.now || defaultNow;
    return {
      runId: String(opts.runId || `wf_${now()}`),
      command: opts.command === 'alt-shift-z' ? 'alt-shift-z' : 'alt-z',
      route: String(opts.route || ''),
      startedAt: now(),
      endedAt: null,
      status: 'running',
      traceId: '',
      spans: [],
    };
  }

  /** 按调用方式预置瀑布细项，开局即展示（再随阶段推进更新耗时）。 */
  function plannedSpanIdsForRoute(route) {
    switch (String(route || '')) {
      case 'builtin':
        return [
          'capture', 'prompt',
          'builtin_probe', 'builtin_create', 'builtin_fit', 'builtin_infer', 'builtin_parse',
          'render',
        ];
      case 'direct':
        return ['capture', 'prompt', 'network', 'llm_wait', 'parse', 'render'];
      case 'saas':
        return ['capture', 'prompt', 'network', 'saas_poll', 'parse', 'render'];
      default:
        return ['capture', 'prompt', 'render'];
    }
  }

  function seedPlannedSpans(run) {
    if (!run || !Array.isArray(run.spans)) return run;
    const ids = plannedSpanIdsForRoute(run.route);
    ids.forEach((id) => {
      run.spans.push({
        id: String(id),
        startMs: 0,
        endMs: 0,
        status: 'pending',
      });
    });
    return run;
  }

  function startSpan(run, id, nowFn) {
    const now = nowFn || defaultNow;
    const key = String(id || '');
    for (let i = 0; i < run.spans.length; i += 1) {
      const existing = run.spans[i];
      if (existing.id === key && existing.status === 'pending') {
        existing.startMs = Math.max(0, now() - run.startedAt);
        existing.endMs = null;
        existing.status = 'running';
        return existing;
      }
    }
    const span = {
      id: key,
      startMs: Math.max(0, now() - run.startedAt),
      endMs: null,
      status: 'running',
    };
    run.spans.push(span);
    return span;
  }

  function findOpenSpan(run, id) {
    for (let i = run.spans.length - 1; i >= 0; i -= 1) {
      const s = run.spans[i];
      if (s.id === id && s.endMs == null) return s;
    }
    return null;
  }

  function endSpan(run, id, nowFn, status) {
    const now = nowFn || defaultNow;
    const span = findOpenSpan(run, id);
    if (!span) return null;
    span.endMs = Math.max(span.startMs, now() - run.startedAt);
    span.status = status || 'ok';
    return span;
  }

  function markUnusedPlanned(run) {
    run.spans.forEach((s) => {
      if (s.status === 'pending') {
        s.status = 'skipped';
        s.endMs = 0;
      }
    });
  }

  function failRun(run, nowFn, traceId) {
    const now = nowFn || defaultNow;
    run.status = 'error';
    run.endedAt = now();
    if (traceId) run.traceId = String(traceId);
    run.spans.forEach((s) => {
      if (s.status === 'pending') {
        s.status = 'skipped';
        s.endMs = 0;
        return;
      }
      if (s.endMs == null) {
        s.endMs = Math.max(s.startMs, run.endedAt - run.startedAt);
        s.status = 'error';
      }
    });
    return run;
  }

  function completeRun(run, nowFn) {
    const now = nowFn || defaultNow;
    run.status = 'ok';
    run.endedAt = now();
    run.spans.forEach((s) => {
      if (s.status === 'pending') {
        s.status = 'skipped';
        s.endMs = 0;
        return;
      }
      if (s.endMs == null) {
        s.endMs = Math.max(s.startMs, run.endedAt - run.startedAt);
        s.status = 'ok';
      }
    });
    return run;
  }

  function serialize(run) {
    const ended = run.endedAt == null ? null : Number(run.endedAt);
    return {
      runId: String(run.runId || ''),
      command: run.command === 'alt-shift-z' ? 'alt-shift-z' : 'alt-z',
      route: String(run.route || ''),
      startedAt: Number(run.startedAt) || 0,
      endedAt: ended,
      status: String(run.status || 'running'),
      traceId: String(run.traceId || ''),
      spans: (run.spans || []).map((s) => ({
        id: String(s.id || ''),
        startMs: Number(s.startMs) || 0,
        endMs: s.endMs == null ? null : Number(s.endMs),
        status: String(s.status || 'running'),
        labelMs: s.labelMs == null || s.labelMs === '' ? null : Number(s.labelMs),
        detail: String(s.detail || ''),
      })),
    };
  }

  function layoutBars(run, nowFn) {
    const now = nowFn || defaultNow;
    const elapsed = Math.max(1, (run.endedAt != null ? run.endedAt : now()) - run.startedAt);
    return (run.spans || []).map((s) => {
      if (s.status === 'pending' || s.status === 'skipped') {
        return {
          id: s.id,
          status: s.status,
          leftPct: 0,
          widthPct: 0,
          durationMs: 0,
          detail: '',
        };
      }
      const end = s.endMs == null ? elapsed : s.endMs;
      const width = Math.max(0, end - s.startMs);
      const labelMs = s.labelMs == null || s.labelMs === '' ? null : Number(s.labelMs);
      return {
        id: s.id,
        status: s.status,
        leftPct: (s.startMs / elapsed) * 100,
        widthPct: (width / elapsed) * 100,
        durationMs: labelMs == null || Number.isNaN(labelMs) ? width : labelMs,
        detail: String(s.detail || ''),
      };
    });
  }

  function addClosedSpan(run, id, startAbs, endAbs, status) {
    const startMs = Math.max(0, Number(startAbs) - run.startedAt);
    const endMs = Math.max(startMs, Number(endAbs) - run.startedAt);
    const span = {
      id: String(id || ''),
      startMs,
      endMs,
      status: status || 'ok',
    };
    run.spans.push(span);
    return span;
  }

  /**
   * 把 `network` 段按 Resource Timing 拆成 wait（requestStart→responseStart，
   * 服务端等待/TTFB）与 download（responseStart→responseEnd，含响应体下载）。
   *
   * entry 时序不可用（缺字段、倒挂）或 timeOrigin 缺失 → null，调用方保持
   * 「整段 network」旧行为。SW 内 Resource Timing 常为空，属预期回退。
   *
   * @param {object|null} entry Resource Timing PerformanceResourceTiming
   * @param {number} timeOriginMs performance.timeOrigin（epoch ms）
   * @returns {{waitStartMs:number, waitEndMs:number, downloadEndMs:number, waitMs:number, downloadMs:number}|null}
   */
  function networkSubspansFromEntry(entry, timeOriginMs) {
    const origin = Number(timeOriginMs);
    if (!entry || !Number.isFinite(origin)) return null;
    const requestStart = Number(entry.requestStart);
    const responseStart = Number(entry.responseStart);
    const responseEnd = Number(entry.responseEnd);
    if (!Number.isFinite(requestStart) || !Number.isFinite(responseStart) || !Number.isFinite(responseEnd)) {
      return null;
    }
    if (responseStart < requestStart || responseEnd < responseStart) return null;
    return {
      waitStartMs: origin + requestStart,
      waitEndMs: origin + responseStart,
      downloadEndMs: origin + responseEnd,
      waitMs: responseStart - requestStart,
      downloadMs: responseEnd - responseStart,
    };
  }

  /**
   * 取与 url 匹配的最近一条 Resource Timing entry；perf/url 不可用或查询抛错 → null。
   * @param {{ getEntriesByName?: (name: string) => unknown[] }|null} perf
   * @param {string} url
   * @returns {object|null}
   */
  function resourceEntryForUrl(perf, url) {
    const key = String(url || '');
    if (!perf || typeof perf.getEntriesByName !== 'function' || !key) return null;
    try {
      const list = perf.getEntriesByName(key);
      return Array.isArray(list) && list.length ? list[list.length - 1] : null;
    } catch (_) {
      return null;
    }
  }

  function rememberHistory(list, run, max) {
    const cap = Number.isFinite(max) && max > 0 ? max : MAX_HISTORY;
    const next = serialize(run);
    const rest = (Array.isArray(list) ? list : []).filter((r) => r && r.runId !== next.runId);
    return [next, ...rest].slice(0, cap);
  }

  function formatByteSize(n) {
    const v = Number(n) || 0;
    if (v <= 0) return '';
    if (v >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)}MB`;
    if (v >= 1024) return `${(v / 1024).toFixed(1)}KB`;
    return `${Math.round(v)}B`;
  }

  /**
   * Replace the closed saas_poll span with backend forward timings.
   * Widths share the poll window; labelMs keeps the measured durations.
   */
  function applySaasForward(run, forward) {
    if (!run || !Array.isArray(run.spans) || !forward) return run;
    const send = Math.max(0, Number(forward.send_ms) || 0);
    const wait = Math.max(0, Number(forward.wait_ms) || 0);
    const recv = Math.max(0, Number(forward.recv_ms) || 0);
    const reqBytes = Math.max(0, Number(forward.request_bytes) || 0);
    const respBytes = Math.max(0, Number(forward.response_bytes) || 0);
    if (send + wait + recv + reqBytes + respBytes <= 0) return run;
    let idx = -1;
    for (let i = run.spans.length - 1; i >= 0; i -= 1) {
      const s = run.spans[i];
      if (s.id === 'saas_poll' && s.endMs != null && s.status !== 'pending' && s.status !== 'skipped') {
        idx = i;
        break;
      }
    }
    if (idx < 0) return run;
    const poll = run.spans[idx];
    const pollStart = Number(poll.startMs) || 0;
    const pollEnd = Number(poll.endMs);
    const pollDur = Math.max(0, pollEnd - pollStart);
    const parts = [];
    const queue = Math.max(0, pollDur - (send + wait + recv));
    if (queue >= 1) parts.push({ id: 'saas_fwd_queue', ms: queue, detail: '' });
    if (send > 0 || reqBytes > 0) parts.push({ id: 'saas_fwd_send', ms: send, detail: formatByteSize(reqBytes) });
    if (wait > 0) parts.push({ id: 'saas_fwd_wait', ms: wait, detail: '' });
    if (recv > 0 || respBytes > 0) parts.push({ id: 'saas_fwd_recv', ms: recv, detail: formatByteSize(respBytes) });
    if (!parts.length) return run;
    const visualSum = parts.reduce((n, p) => n + Math.max(p.ms, 0), 0);
    const budget = pollDur > 0 ? pollDur : (visualSum || 1);
    const scaleBase = visualSum > 0 ? visualSum : 1;
    let cursor = pollStart;
    const placed = parts.map((p) => {
      const slice = budget * (Math.max(p.ms, 0) / scaleBase);
      const startMs = cursor;
      cursor += slice;
      return {
        id: p.id,
        startMs,
        endMs: cursor,
        status: poll.status === 'error' ? 'error' : 'ok',
        labelMs: p.ms,
        detail: p.detail,
      };
    });
    if (placed.length && pollDur > 0) placed[placed.length - 1].endMs = pollEnd;
    run.spans.splice(idx, 1, ...placed);
    return run;
  }

  async function withSpan(run, id, nowFn, fn, hooks) {
    startSpan(run, id, nowFn);
    if (hooks && typeof hooks.onStart === 'function') {
      try { hooks.onStart(); } catch (_) { /* ignore UI hook errors */ }
    }
    try {
      const value = await fn();
      endSpan(run, id, nowFn, 'ok');
      return value;
    } catch (err) {
      endSpan(run, id, nowFn, 'error');
      throw err;
    }
  }

  return {
    MAX_HISTORY,
    SPAN_IDS,
    createRun,
    plannedSpanIdsForRoute,
    seedPlannedSpans,
    startSpan,
    endSpan,
    failRun,
    completeRun,
    markUnusedPlanned,
    serialize,
    layoutBars,
    addClosedSpan,
    networkSubspansFromEntry,
    resourceEntryForUrl,
    rememberHistory,
    formatByteSize,
    applySaasForward,
    withSpan,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorTiming;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorTiming = PageAdvisorTiming;
}
