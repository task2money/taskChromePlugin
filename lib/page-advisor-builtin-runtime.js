/**
 * 本机内置模型运行时快照（chrome.storage.session）。
 * 不含页面正文 / API Key。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.PageAdvisorBuiltinRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function pageAdvisorBuiltinRuntimeFactory() {
  const STORAGE_KEY = 'pageAdvisorBuiltinRuntime';
  const PHASES = {
    idle: 'idle',
    collecting: 'collecting',
    generating: 'generating',
    done: 'done',
    failed: 'failed',
    downloading: 'downloading',
  };
  const COLLECTING_STALE_MS = 8000;
  const ENABLE_STALE_MS = 180000;
  const ENABLE_WATCHDOG_ALARM = 'builtin-enable-watchdog';

  function isFreshInFlight(snap, now) {
    const phase = snap && snap.phase;
    if (phase !== PHASES.collecting && phase !== PHASES.generating) return false;
    const updated = Number(snap && snap.updatedAt) || 0;
    const n = now || Date.now();
    return updated > 0 && (n - updated) < COLLECTING_STALE_MS;
  }

  function effectivePhase(snap, now) {
    const phase = (snap && snap.phase) || PHASES.idle;
    if (phase === PHASES.downloading) return phase;
    if (phase === PHASES.collecting || phase === PHASES.generating) {
      return isFreshInFlight(snap, now) ? phase : PHASES.idle;
    }
    return phase;
  }

  function enableTimeoutMs(snap, overrideMs) {
    const n = Number(overrideMs);
    if (Number.isFinite(n) && n > 0) return n;
    return ENABLE_STALE_MS;
  }

  function isEnableStale(snap, now, overrideMs) {
    if (!snap || !snap.downloadInFlight) return false;
    const limit = enableTimeoutMs(snap, overrideMs);
    const n = now || Date.now();
    const hundred = Number(snap.enableHundredAt) || 0;
    if (hundred > 0) return (n - hundred) >= limit;
    const started = Number(snap.enableStartedAt) || 0;
    if (started > 0) return (n - started) >= limit;
    const updated = Number(snap.updatedAt) || 0;
    if (updated > 0) return (n - updated) >= limit;
    return false;
  }

  function enableWaitedSec(snap, now) {
    const n = now || Date.now();
    const hundred = Number(snap && snap.enableHundredAt) || 0;
    const started = Number(snap && snap.enableStartedAt) || 0;
    const from = hundred > 0 ? hundred : started;
    if (from <= 0) return 0;
    return Math.max(0, Math.floor((n - from) / 1000));
  }

  async function recoverIfStale(storage, now, overrideMs) {
    const snap = await read(storage);
    if (!snap.downloadInFlight) {
      return { recovered: false, stillInFlight: false, snap };
    }
    if (!isEnableStale(snap, now || Date.now(), overrideMs)) {
      return { recovered: false, stillInFlight: true, snap };
    }
    const next = await write({
      downloadInFlight: false,
      lastErrorCode: 'enable_stale',
      phase: snap.availability === 'downloading' ? 'downloading' : 'idle',
    }, storage);
    return { recovered: true, stillInFlight: false, snap: next };
  }

  function scheduleEnableWatchdog() {
    if (typeof chrome === 'undefined' || !chrome.alarms || typeof chrome.alarms.create !== 'function') {
      return;
    }
    try {
      chrome.alarms.create(ENABLE_WATCHDOG_ALARM, { delayInMinutes: 3 });
    } catch (_) { /* ignore */ }
  }

  function phaseForSettingsProbe(snap, availability, opts) {
    void opts;
    const av = String(availability || '');
    if (av === 'downloading') return PHASES.downloading;
    if (snap && snap.phase === PHASES.downloading && av !== 'available') {
      return PHASES.downloading;
    }
    // 设置页只反映模型可用性/下载，不展示 Alt+Z 采集/推理。
    return PHASES.idle;
  }

  function statusLineForSettings(snapshot, tx) {
    const snap = snapshot || {};
    const phase = phaseForSettingsProbe(snap, snap.availability, { clearInFlight: true });
    return statusLine({ ...snap, phase }, tx);
  }

  function nowMs() {
    return Date.now();
  }

  function sanitize(patch) {
    const out = {};
    if (!patch || typeof patch !== 'object') return out;
    if (patch.phase != null) out.phase = String(patch.phase);
    if (patch.availability != null) out.availability = String(patch.availability);
    if (patch.message != null) out.message = String(patch.message).slice(0, 500);
    if (patch.downloadPct != null && Number.isFinite(Number(patch.downloadPct))) {
      out.downloadPct = Math.max(0, Math.min(100, Math.floor(Number(patch.downloadPct))));
    }
    if (patch.lastOkAt != null && Number.isFinite(Number(patch.lastOkAt))) {
      out.lastOkAt = Number(patch.lastOkAt);
    }
    if (patch.lastErrorCode != null) out.lastErrorCode = String(patch.lastErrorCode).slice(0, 120);
    if (patch.skippedSkill != null) out.skippedSkill = !!patch.skippedSkill;
    if (patch.durationMs != null && Number.isFinite(Number(patch.durationMs))) {
      out.durationMs = Math.max(0, Math.floor(Number(patch.durationMs)));
    }
    if (patch.language != null) out.language = String(patch.language).slice(0, 16);
    if (patch.inputQuota != null && Number.isFinite(Number(patch.inputQuota))) {
      out.inputQuota = Number(patch.inputQuota);
    }
    if (patch.paramsSummary != null) out.paramsSummary = String(patch.paramsSummary).slice(0, 240);
    if (patch.downloadInFlight != null) out.downloadInFlight = !!patch.downloadInFlight;
    if (patch.enableStartedAt != null && Number.isFinite(Number(patch.enableStartedAt))) {
      out.enableStartedAt = Number(patch.enableStartedAt);
    }
    if (patch.enableHundredAt != null && Number.isFinite(Number(patch.enableHundredAt))) {
      out.enableHundredAt = Number(patch.enableHundredAt);
    }
    if (patch.enableOwner != null) out.enableOwner = String(patch.enableOwner).slice(0, 32);
    // 显式丢弃危险字段
    return out;
  }

  function mergeSnapshot(prev, patch) {
    const base = prev && typeof prev === 'object' ? { ...prev } : { phase: PHASES.idle };
    const next = { ...base, ...sanitize(patch), updatedAt: nowMs() };
    delete next.pageText;
    delete next.apiKey;
    delete next.prompt;
    return next;
  }

  async function read(storage) {
    const store = storage || (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session);
    if (!store || typeof store.get !== 'function') {
      return { phase: PHASES.idle, updatedAt: 0 };
    }
    const bag = await store.get(STORAGE_KEY);
    const cur = bag && bag[STORAGE_KEY];
    if (!cur || typeof cur !== 'object') return { phase: PHASES.idle, updatedAt: 0 };
    return mergeSnapshot({ phase: PHASES.idle }, cur);
  }

  async function write(patch, storage) {
    const store = storage || (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session);
    if (!store || typeof store.set !== 'function') return mergeSnapshot(null, patch);
    const prev = await read(store);
    const next = mergeSnapshot(prev, patch);
    await store.set({ [STORAGE_KEY]: next });
    return next;
  }

  function downloadingLine(snap, t) {
    const pctNum = snap && snap.downloadPct != null ? Number(snap.downloadPct) : NaN;
    const pct = Number.isFinite(pctNum) ? String(pctNum) : '…';
    if (Number.isFinite(pctNum) && pctNum >= 100) {
      if (snap && snap.downloadInFlight && !isEnableStale(snap)) {
        const sec = enableWaitedSec(snap);
        if (sec > 0) return t('paBuiltinEnablingWait', { pct, sec: String(sec) });
        return t('paBuiltinEnabling', { pct });
      }
      return t('paBuiltinDownloadNeedEnable', { pct });
    }
    return t('paBuiltinDownloading', { pct });
  }

  function statusLine(snapshot, tx) {
    const t = typeof tx === 'function' ? tx : (k) => k;
    const snap = snapshot || {};
    const phase = effectivePhase(snap);
    if (phase === PHASES.collecting) return t('paCollecting');
    if (phase === PHASES.generating) return t('paBuiltinInferring');
    if (phase === PHASES.downloading) return downloadingLine(snap, t);
    if (phase === PHASES.failed) return snap.message || t('paBuiltinFailed');
    if (phase === PHASES.done) {
      if (snap.skippedSkill) return t('paBuiltinSkippedSkill');
      return snap.message || t('paBuiltinReady');
    }
    const availability = snap.availability;
    if (availability === 'available') return t('paBuiltinReady');
    if (availability === 'downloadable') return t('paBuiltinNeedsDownload');
    if (availability === 'downloading') return downloadingLine(snap, t);
    if (availability === 'unavailable') return t('paBuiltinUnavailable');
    return t('paBuiltinReady');
  }

  return {
    STORAGE_KEY,
    PHASES,
    COLLECTING_STALE_MS,
    ENABLE_STALE_MS,
    ENABLE_WATCHDOG_ALARM,
    sanitize,
    mergeSnapshot,
    read,
    write,
    statusLine,
    isFreshInFlight,
    isEnableStale,
    enableWaitedSec,
    recoverIfStale,
    scheduleEnableWatchdog,
    effectivePhase,
    phaseForSettingsProbe,
    statusLineForSettings,
  };
});
