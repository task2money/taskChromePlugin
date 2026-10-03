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

  async function probeDetails(opts) {
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
    const phase = (Runtime && typeof Runtime.phaseForSettingsProbe === 'function')
      ? Runtime.phaseForSettingsProbe(snap, availability, {
        clearInFlight: !!(opts && opts.clearInFlight),
      })
      : 'idle';
    if (statusEl && Runtime) {
      const lineFn = typeof Runtime.statusLineForSettings === 'function'
        ? Runtime.statusLineForSettings
        : Runtime.statusLine;
      if (typeof lineFn === 'function') {
        statusEl.textContent = lineFn({
          ...(snap || {}),
          availability,
          phase,
        }, typeof tx === 'function' ? tx : (k) => k);
      }
    }
    if (download) {
      download.hidden = availability !== 'downloadable' && availability !== 'downloading';
      // 字节已下完但 availability 仍报 downloading：动作其实是「启用」，文案对齐以免用户以为要再下一次。
      const finishEnable = availability === 'downloading'
        && snap && Number(snap.downloadPct) >= 100;
      const labelKey = finishEnable ? 'paBuiltinFinishEnable' : 'paBuiltinDownload';
      download.textContent = typeof tx === 'function'
        ? tx(labelKey)
        : (finishEnable ? '完成启用' : '下载模型');
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
          const patch = {
            paramsSummary,
            availability,
            language: Builtin.promptLanguage(locale()),
          };
          if (phase === 'downloading') patch.phase = phase;
          await Runtime.write(patch);
        }
      } catch (_) { /* ignore */ }
    }
    if (paramsEl) paramsEl.textContent = paramsSummary;
    let quotaText = '—';
    if (availability === 'available' && typeof lm.create === 'function') {
      try {
        const createOpts = (typeof Builtin.resolveLanguageOptions === 'function')
          ? await Builtin.resolveLanguageOptions(lm, locale())
          : Builtin.languageOptions(locale());
        const session = await lm.create(createOpts);
        const q = session && (session.inputQuota != null ? session.inputQuota : session.contextWindow);
        if (Number.isFinite(Number(q))) {
          quotaText = String(q);
          if (Runtime && Runtime.write) await Runtime.write({ inputQuota: Number(q) });
        }
        if (paramsSummary === '—' && session) {
          const t = session.temperature;
          const k = session.topK;
          if (t != null || k != null) {
            paramsSummary = `temp=${t != null ? t : '—'}; topK=${k != null ? k : '—'}`;
            if (paramsEl) paramsEl.textContent = paramsSummary;
          }
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
    const run = async () => {
      const statusEl = $('#spBuiltinStatus');
      const btn = $('#spBuiltinRefresh');
      setBusy(btn, true);
      if (statusEl && typeof tx === 'function') {
        statusEl.textContent = tx('paBuiltinRefreshing');
      }
      try {
        await probeDetails({ clearInFlight: true });
      } finally {
        setBusy(btn, false);
      }
    };
    if (refreshGuard) refreshGuard.run(run).catch(() => {});
    else run().catch(() => {});
  }

  function onDownload() {
    const run = async () => {
      const btn = $('#spBuiltinDownload');
      const statusEl = $('#spBuiltinStatus');
      setBusy(btn, true);
      if (statusEl && typeof tx === 'function') {
        statusEl.textContent = tx('paBuiltinDownloading', { pct: '0' });
      }
      try {
        await PageAdvisorBuiltinPrompt.startDownload(globalThis.LanguageModel, locale(), {
          onProgress(pct) {
            if (statusEl && typeof tx === 'function') {
              statusEl.textContent = Number(pct) >= 100
                ? tx('paBuiltinEnabling', { pct })
                : tx('paBuiltinDownloading', { pct });
            }
          },
        });
        await probeDetails();
      } catch (err) {
        // 失败须可见：不可仅 probeDetails 静默吞掉（用户感知为「点了没反响」）
        if (statusEl) {
          const base = typeof tx === 'function' ? tx('paBuiltinFailed') : 'failed';
          const detail = err && err.message ? String(err.message).slice(0, 160) : '';
          statusEl.textContent = detail ? `${base} (${detail})` : base;
        }
        await probeDetails().catch(() => {});
      } finally {
        setBusy(btn, false);
      }
    };
    if (downloadGuard) downloadGuard.run(run).catch(() => {});
    else run().catch(() => {});
  }

  function onCancel() {
    const run = async () => {
      const statusEl = $('#spBuiltinStatus');
      const cancelled = PageAdvisorBuiltinPrompt.cancelDownload
        ? PageAdvisorBuiltinPrompt.cancelDownload()
        : false;
      if (!cancelled && statusEl && typeof tx === 'function') {
        statusEl.textContent = tx('paBuiltinNeedsDownload');
      }
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
    // 「本机模型」含出售注册；始终展示，LanguageModel 不可用时面板内自行提示。
    if (tab) tab.hidden = false;
  }

  function onOpenInternals(e) {
    if (e) e.preventDefault();
    // 常显警示拦不住误点：进入可改坏本机模型的页面要先确认。
    const confirmFn = typeof globalThis.confirm === 'function' ? globalThis.confirm : null;
    if (confirmFn) {
      const caution = typeof tx === 'function' ? tx('paBuiltinOnDeviceInternalsCaution') : '';
      const message = String(caution || '').replace(/^[。.]+/, '').trim()
        || 'chrome://on-device-internals';
      if (!confirmFn(message)) return;
    }
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
        const Runtime = globalThis.PageAdvisorBuiltinRuntime;
        const key = Runtime && Runtime.STORAGE_KEY;
        if (!key || !changes[key]) return;
        const nv = changes[key].newValue || {};
        const statusEl = $('#spBuiltinStatus');
        if (!statusEl || !Runtime) return;
        const lineFn = typeof Runtime.statusLineForSettings === 'function'
          ? Runtime.statusLineForSettings
          : Runtime.statusLine;
        if (typeof lineFn === 'function') {
          statusEl.textContent = lineFn(nv, typeof tx === 'function' ? tx : (k) => k);
        }
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
