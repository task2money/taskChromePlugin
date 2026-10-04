/**
 * 本机模型下载/解压进度条与启用心跳。
 * Chrome 在 downloadprogress=100% 后不再发事件；心跳写 enablePct 并探测 available。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.PageAdvisorBuiltinProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function pageAdvisorBuiltinProgressFactory() {
  const DEFAULT_HEARTBEAT_MS = 500;

  function progressPercent(event) {
    const loaded = Number(event && event.loaded);
    const total = Number(event && event.total);
    if (!Number.isFinite(loaded) || loaded < 0) return 0;
    if (loaded <= 1 && (!Number.isFinite(total) || total <= 1)) {
      return Math.min(100, Math.floor(loaded * 100));
    }
    if (Number.isFinite(total) && total > 0) {
      return Math.min(100, Math.floor((loaded / total) * 100));
    }
    return 0;
  }

  function watchDownload(monitor, onProgress) {
    if (!monitor || typeof monitor.addEventListener !== 'function' || typeof onProgress !== 'function') return;
    monitor.addEventListener('downloadprogress', (event) => {
      onProgress(progressPercent(event));
    });
  }

  function applyProgressBar(el, model) {
    if (!el) return;
    const bar = model || { visible: false };
    if (!bar.visible) {
      el.hidden = true;
      if (typeof el.removeAttribute === 'function') el.removeAttribute('value');
      return;
    }
    el.hidden = false;
    el.max = bar.max || 100;
    if (bar.indeterminate) {
      if (typeof el.removeAttribute === 'function') el.removeAttribute('value');
    } else if (typeof el.setAttribute === 'function') {
      el.value = bar.value;
      el.setAttribute('value', String(bar.value));
    } else {
      el.value = bar.value;
    }
    if (typeof el.setAttribute === 'function') {
      if (bar.kind) el.setAttribute('data-kind', bar.kind);
      el.setAttribute('aria-valuenow', String(bar.value || 0));
    }
  }

  function readyRuntimePatch() {
    return {
      phase: 'idle',
      availability: 'available',
      downloadPct: 100,
      enablePct: 100,
      downloadInFlight: false,
      lastErrorCode: '',
      message: '',
      enableOwner: '',
    };
  }

  function attachEnableAfterDownload(state, pct, patch, opts) {
    if (pct < 100 || !state || state.hundredMarked) return patch;
    state.hundredMarked = true;
    patch.enableHundredAt = Date.now();
    patch.enablePct = 1;
    const controller = opts && opts.controller;
    const enableMs = Number(opts && opts.enableMs);
    if (controller && Number.isFinite(enableMs) && enableMs > 0) {
      state.hundredTimer = setTimeout(() => {
        try { controller.abort(); } catch (_) { /* ignore */ }
      }, enableMs);
    }
    state.heartbeat = startEnableHeartbeat({
      intervalMs: opts && opts.intervalMs,
      languageModel: opts && opts.languageModel,
      locale: opts && opts.locale,
      probe: opts && opts.probe,
      onTick: opts && opts.onTick,
      onReady: opts && opts.onReady,
    });
    return patch;
  }

  function startEnableHeartbeat(opts) {
    const Runtime = typeof PageAdvisorBuiltinRuntime !== 'undefined' ? PageAdvisorBuiltinRuntime : null;
    if (!Runtime || typeof Runtime.write !== 'function') {
      return { stop() {} };
    }
    const intervalMs = Number(opts && opts.intervalMs);
    const ms = Number.isFinite(intervalMs) && intervalMs >= 0 ? intervalMs : DEFAULT_HEARTBEAT_MS;
    if (ms === 0) return { stop() {} };
    const probeFn = opts && typeof opts.probe === 'function' ? opts.probe : null;
    const languageModel = opts && opts.languageModel;
    const locale = opts && opts.locale;
    const onTick = opts && typeof opts.onTick === 'function' ? opts.onTick : null;
    const onReady = opts && typeof opts.onReady === 'function' ? opts.onReady : null;
    let stopped = false;
    let timer = null;

    async function tick() {
      if (stopped) return;
      let snap = await Runtime.read();
      if (!snap || !snap.downloadInFlight) {
        return;
      }
      if (Runtime.isEnableStale && Runtime.isEnableStale(snap)) {
        stop();
        return;
      }
      const loadPct = Runtime.enableLoadPercentFromSnap
        ? Runtime.enableLoadPercentFromSnap(snap)
        : 0;
      if (onTick) onTick(loadPct, snap);
      let av = '';
      if (probeFn) {
        try { av = await probeFn(languageModel, locale); } catch (_) { av = ''; }
      }
      if (stopped) return;
      snap = await Runtime.read();
      if (!snap || !snap.downloadInFlight) {
        stop();
        return;
      }
      if (av === 'available') {
        await Runtime.write({
          phase: 'idle',
          availability: 'available',
          downloadPct: 100,
          enablePct: 100,
          downloadInFlight: false,
          lastErrorCode: '',
          message: '',
          enableOwner: '',
        });
        console.info('[taskChromePlugin] builtin enable probe became available');
        if (onReady) onReady();
        stop();
        return;
      }
      await Runtime.write({ enablePct: loadPct, downloadInFlight: true });
    }

    function stop() {
      stopped = true;
      if (timer) {
        try { clearInterval(timer); } catch (_) { /* ignore */ }
        timer = null;
      }
    }

    timer = setInterval(() => { tick().catch(() => {}); }, ms);
    tick().catch(() => {});
    return { stop };
  }

  return {
    DEFAULT_HEARTBEAT_MS,
    progressPercent,
    watchDownload,
    applyProgressBar,
    readyRuntimePatch,
    attachEnableAfterDownload,
    startEnableHeartbeat,
  };
});
