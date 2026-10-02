/**
 * 侧栏「内置模型」完整管理面板。
 */
(function initBuiltinModelPanel() {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const refreshGuard = (typeof ClickGuard !== 'undefined' && ClickGuard.createClickGuard)
    ? ClickGuard.createClickGuard({ debounceMs: 400 })
    : null;
  const downloadGuard = (typeof ClickGuard !== 'undefined' && ClickGuard.createClickGuard)
    ? ClickGuard.createClickGuard({ debounceMs: 400 })
    : null;
  const cancelGuard = (typeof ClickGuard !== 'undefined' && ClickGuard.createClickGuard)
    ? ClickGuard.createClickGuard({ debounceMs: 400 })
    : null;

  function locale() {
    try {
      if (typeof AidevpushI18n !== 'undefined' && typeof AidevpushI18n.getLocale === 'function') {
        return AidevpushI18n.getLocale() || 'zh-CN';
      }
    } catch (_) { /* ignore */ }
    return 'zh-CN';
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = !!busy;
    if (busy) btn.setAttribute('aria-busy', 'true');
    else btn.removeAttribute('aria-busy');
  }

  async function probeDetails() {
    const lm = globalThis.LanguageModel;
    const Builtin = globalThis.PageAdvisorBuiltinPrompt;
    const Runtime = globalThis.PageAdvisorBuiltinRuntime;
    const statusEl = $('#spBuiltinStatus');
    const paramsEl = $('#spBuiltinParams');
    const quotaEl = $('#spBuiltinQuota');
    const lastEl = $('#spBuiltinLastRun');
    const download = $('#spBuiltinDownload');
    const cancel = $('#spBuiltinCancel');
    if (!lm || !Builtin) {
      if (statusEl) statusEl.textContent = typeof tx === 'function' ? tx('paBuiltinUnavailable') : 'unavailable';
      return { supported: false };
    }
    let availability = 'unavailable';
    try {
      availability = await Builtin.probe(lm, locale());
    } catch (_) {
      availability = 'unavailable';
    }
    let snap = null;
    if (Runtime && Runtime.read) {
      try { snap = await Runtime.read(); } catch (_) { snap = null; }
    }
    if (statusEl && Runtime && Runtime.statusLine) {
      statusEl.textContent = Runtime.statusLine({
        ...(snap || {}),
        availability,
        phase: (snap && (snap.phase === 'generating' || snap.phase === 'collecting'
          || snap.phase === 'downloading' || snap.phase === 'failed' || snap.phase === 'done'))
          ? snap.phase
          : 'idle',
      }, typeof tx === 'function' ? tx : (k) => k);
    }
    if (download) {
      download.hidden = availability !== 'downloadable' && availability !== 'downloading';
    }
    if (cancel) {
      cancel.hidden = availability !== 'downloading'
        && !(snap && snap.phase === 'downloading');
    }
    let paramsSummary = '—';
    if (typeof lm.params === 'function') {
      try {
        const p = await lm.params();
        paramsSummary = `temp≤${p.maxTemperature}; defaultTopK=${p.defaultTopK}`;
        if (Runtime && Runtime.write) {
          await Runtime.write({ paramsSummary, availability, language: Builtin.promptLanguage(locale()) });
        }
      } catch (_) { /* ignore */ }
    }
    if (paramsEl) paramsEl.textContent = paramsSummary;
    let quotaText = '—';
    if (availability === 'available' && typeof lm.create === 'function') {
      try {
        const session = await lm.create(Builtin.languageOptions(locale()));
        const q = session && session.inputQuota;
        if (Number.isFinite(Number(q))) {
          quotaText = String(q);
          if (Runtime && Runtime.write) await Runtime.write({ inputQuota: Number(q) });
        }
        if (session && typeof session.destroy === 'function') session.destroy();
      } catch (_) { /* ignore */ }
    }
    if (quotaEl) quotaEl.textContent = quotaText;
    if (lastEl) {
      if (snap && (snap.lastOkAt || snap.phase === 'failed' || snap.durationMs != null)) {
        const parts = [];
        if (snap.phase) parts.push(snap.phase);
        if (snap.durationMs != null) parts.push(`${snap.durationMs}ms`);
        if (snap.lastErrorCode) parts.push(snap.lastErrorCode);
        if (snap.skippedSkill) parts.push('skippedSkill');
        lastEl.textContent = parts.join(' · ') || '—';
      } else {
        lastEl.textContent = '—';
      }
    }
    return { supported: true, availability };
  }

  function onRefresh() {
    const run = () => probeDetails();
    if (refreshGuard) refreshGuard.run(run).catch(() => {});
    else run().catch(() => {});
  }

  function onDownload() {
    const run = async () => {
      const btn = $('#spBuiltinDownload');
      setBusy(btn, true);
      try {
        await PageAdvisorBuiltinPrompt.startDownload(globalThis.LanguageModel, locale(), {
          onProgress() { probeDetails().catch(() => {}); },
        });
        await probeDetails();
      } catch (_) {
        await probeDetails();
      } finally {
        setBusy(btn, false);
      }
    };
    if (downloadGuard) downloadGuard.run(run).catch(() => {});
    else run().catch(() => {});
  }

  function onCancel() {
    const run = async () => {
      if (PageAdvisorBuiltinPrompt.cancelDownload) PageAdvisorBuiltinPrompt.cancelDownload();
      await probeDetails();
    };
    if (cancelGuard) cancelGuard.run(run).catch(() => {});
    else run().catch(() => {});
  }

  function languageModelSupported() {
    const lm = globalThis.LanguageModel;
    return !!(lm && typeof lm.availability === 'function');
  }

  function updateTabVisibility() {
    const tab = $('#sp-tab-builtin');
    if (tab) tab.hidden = !languageModelSupported();
  }

  function onOpenInternals(e) {
    if (e) e.preventDefault();
    const Open = globalThis.OpenChromeUrl;
    const url = (Open && Open.ON_DEVICE_INTERNALS) || 'chrome://on-device-internals';
    const open = Open && Open.openChromeUrl
      ? Open.openChromeUrl(url)
      : (chrome.tabs && chrome.tabs.create
        ? chrome.tabs.create({ url })
        : Promise.reject(new Error('tabs.create unavailable')));
    open.catch(() => {});
  }

  function bind() {
    const refresh = $('#spBuiltinRefresh');
    const download = $('#spBuiltinDownload');
    const cancel = $('#spBuiltinCancel');
    const internals = $('#spBuiltinInternalsLink');
    if (refresh) refresh.addEventListener('click', onRefresh);
    if (download) download.addEventListener('click', onDownload);
    if (cancel) cancel.addEventListener('click', onCancel);
    if (internals) internals.addEventListener('click', onOpenInternals);
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'session') return;
        const key = PageAdvisorBuiltinRuntime && PageAdvisorBuiltinRuntime.STORAGE_KEY;
        if (key && changes[key]) probeDetails().catch(() => {});
      });
    }
    updateTabVisibility();
    if (languageModelSupported()) probeDetails().catch(() => {});
  }

  globalThis.SidepanelBuiltinPanel = {
    probeDetails,
    updateTabVisibility,
    languageModelSupported,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
