/**
 * Alt+Z / Alt+Shift+Z 本机耗时 run/span。不含密钥与页面正文。
 */
'use strict';

const PageAdvisorTiming = (() => {
  const MAX_HISTORY = 5;
  const SPAN_IDS = Object.freeze([
    'capture', 'prompt', 'network', 'network_wait', 'network_download',
    'llm_wait', 'saas_poll', 'builtin',
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
        };
      }
      const end = s.endMs == null ? elapsed : s.endMs;
      const width = Math.max(0, end - s.startMs);
      return {
        id: s.id,
        status: s.status,
        leftPct: (s.startMs / elapsed) * 100,
        widthPct: (width / elapsed) * 100,
        durationMs: width,
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
    withSpan,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorTiming;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorTiming = PageAdvisorTiming;
}
