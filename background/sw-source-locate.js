/**
 * Page source-map locating orchestration (service worker).
 * Message handling, run registry, result cache and cancellation live here;
 * the scan/fetch runner is in sw-source-locate-run.js (each file ≤500 lines).
 */

'use strict';

(function (global) {
  const RUN_REGISTRY_MAX = 16;
  const RESULT_CACHE_MAX = 64;
  const RESULT_CACHE_TTL = 5 * 60 * 1000;
  const MODE_TIMEOUT = { element: 6000, advisor: 3000 };

  const Run = global.SwSourceLocateRun
    || (typeof require === 'function' ? require('./sw-source-locate-run.js') : null);

  const runs = new Map();
  const resultCache = new Map();
  let lifecycleRegistered = false;

  function now() {
    return Date.now();
  }

  function abortRunsForTab(tabId) {
    for (const [runId, run] of Array.from(runs.entries())) {
      if (run.tabId === tabId) {
        run.cancelled = true;
        try { run.controller.abort(); } catch (_) { /* ignore */ }
        runs.delete(runId);
      }
    }
  }

  function registerLifecycle() {
    if (lifecycleRegistered) return;
    lifecycleRegistered = true;
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onRemoved) {
        chrome.tabs.onRemoved.addListener((tabId) => abortRunsForTab(tabId));
      }
      if (typeof chrome !== 'undefined' && chrome.webNavigation && chrome.webNavigation.onCommitted) {
        chrome.webNavigation.onCommitted.addListener((details) => {
          if (details && details.frameId === 0) abortRunsForTab(details.tabId);
        });
      }
    } catch (_) {
      // Lifecycle hooks are best-effort; message-level cancel still works.
    }
  }

  function cacheKey(message, items) {
    return `${String(message.pageUrl || '')}|${JSON.stringify(items)}`;
  }

  async function runWithTimeout(message, sender) {
    if (!Run) return { ok: false, error: 'fetch-failed' };
    const runId = String(message.runId || `sl-${now()}-${Math.random().toString(36).slice(2)}`).slice(0, 128);
    const tabId = sender && sender.tab ? sender.tab.id : null;
    const mode = message.mode === 'advisor' ? 'advisor' : 'element';
    const requested = Number(message.timeoutMs);
    const timeoutMs = Number.isFinite(requested) && requested > 0
      ? Math.min(Math.max(requested, 100), 15000)
      : MODE_TIMEOUT[mode];

    const items = Run.normalizeItems(message.items);
    if (!items.length) return { ok: false, runId, error: 'invalid' };

    const key = cacheKey(message, items);
    const cached = Run.cacheGet(resultCache, key, RESULT_CACHE_TTL);
    if (cached) {
      return {
        ok: true,
        runId,
        results: cached.results,
        stats: { ...cached.stats, cacheHit: true },
      };
    }

    if (runs.size >= RUN_REGISTRY_MAX) {
      const oldest = runs.keys().next().value;
      const oldRun = runs.get(oldest);
      try { oldRun.controller.abort(); } catch (_) { /* ignore */ }
      runs.delete(oldest);
    }
    const controller = new AbortController();
    const runState = { controller, tabId, startedAt: now(), cancelled: false, timedOut: false };
    runs.set(runId, runState);

    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        runState.timedOut = true;
        try { controller.abort(); } catch (_) { /* ignore */ }
        reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
      }, timeoutMs);
    });

    try {
      const outcome = await Promise.race([Run.runSourceLocate(message, controller.signal), timeout]);
      if (outcome.error) {
        return { ok: false, runId, error: outcome.error, stats: outcome.stats || {} };
      }
      Run.cacheSet(resultCache, key, { results: outcome.results, stats: outcome.stats }, RESULT_CACHE_MAX);
      return { ok: true, runId, results: outcome.results, stats: { ...outcome.stats, cacheHit: false } };
    } catch (err) {
      const code = runState.timedOut
        ? 'timeout'
        : (runState.cancelled
          ? 'cancelled'
          : (err && err.code ? err.code : 'fetch-failed'));
      return { ok: false, runId, error: code };
    } finally {
      if (timer) clearTimeout(timer);
      runs.delete(runId);
    }
  }

  async function handleSourceLocateMessage(message, sender) {
    registerLifecycle();
    if (!message || (message.action !== 'sourceLocate' && message.action !== 'sourceLocateCancel')) {
      return undefined;
    }
    if (message.action === 'sourceLocateCancel') {
      const runId = String(message.runId || '');
      const run = runs.get(runId);
      if (run) {
        run.cancelled = true;
        try { run.controller.abort(); } catch (_) { /* ignore */ }
        runs.delete(runId);
        return { ok: true, runId, cancelled: true };
      }
      return { ok: true, runId, cancelled: false };
    }
    return runWithTimeout(message, sender);
  }

  const SwSourceLocate = {
    handleSourceLocateMessage,
    __test: {
      runSourceLocate: Run ? Run.runSourceLocate : null,
      normalizeItems: Run ? Run.normalizeItems : null,
      buildEvidenceIndex: Run ? Run.buildEvidenceIndex : null,
      searchText: Run ? Run.searchText : null,
      reset() {
        runs.clear();
        resultCache.clear();
        if (Run) Run.resetCaches();
      },
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SwSourceLocate;
  }
  global.SwSourceLocate = SwSourceLocate;
  global.handleSourceLocateMessage = handleSourceLocateMessage;
}(typeof globalThis !== 'undefined' ? globalThis : this));
