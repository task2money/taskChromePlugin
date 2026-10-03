/** Popup / sidepanel host：内置模型状态与基础管理（本机，无 HTTP）。 */
(function (global) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const downloadGuard = (typeof ClickGuard !== 'undefined' && ClickGuard.createClickGuard)
    ? ClickGuard.createClickGuard({ debounceMs: 400 })
    : null;
  const refreshGuard = (typeof ClickGuard !== 'undefined' && ClickGuard.createClickGuard)
    ? ClickGuard.createClickGuard({ debounceMs: 400 })
    : null;
  const cancelGuard = (typeof ClickGuard !== 'undefined' && ClickGuard.createClickGuard)
    ? ClickGuard.createClickGuard({ debounceMs: 400 })
    : null;
  let runtimeUnsub = null;

  function isSidepanelHost() {
    try {
      return document.documentElement.getAttribute('data-taskplugin-host') === 'sidepanel';
    } catch (_) {
      return false;
    }
  }

  function downloadBtn() {
    return $('#btnDownloadBuiltinModel') || $('#btnDownloadBuiltinModelPopup');
  }

  function popupLocale() {
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
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (!busy) btn.removeAttribute('aria-busy');
  }

  async function applyBuiltinStatusFromProbe(availability, runtimeSnap, selectedRouteMode) {
    const status = $('#popupBuiltinStatus');
    const download = downloadBtn();
    const cancel = $('#btnCancelBuiltinDownload');
    const basic = $('#popupBuiltinBasicMgmt');
    const refresh = $('#btnRefreshBuiltinStatus');
    const openFull = $('#btnOpenBuiltinFullMgmt');
    const side = isSidepanelHost();
    if (basic) basic.hidden = false;
    if (refresh) refresh.hidden = false;
    if (openFull) openFull.hidden = !side;
    const popupOnly = $('#btnDownloadBuiltinModelPopup');
    if (popupOnly) popupOnly.hidden = true;
    const Runtime = typeof PageAdvisorBuiltinRuntime !== 'undefined' ? PageAdvisorBuiltinRuntime : null;
    let line = '';
    if (Runtime && runtimeSnap) {
      const lineFn = typeof Runtime.statusLineForSettings === 'function'
        ? Runtime.statusLineForSettings
        : Runtime.statusLine;
      if (typeof lineFn === 'function') {
        line = lineFn({ ...(runtimeSnap || {}), availability }, tx);
      }
    }
    if (!line) {
      if (availability === 'available') line = tx('paBuiltinReady');
      else if (availability === 'downloadable') line = tx('paBuiltinNeedsDownload');
      else if (availability === 'downloading') {
        const pct = runtimeSnap && runtimeSnap.downloadPct != null ? String(runtimeSnap.downloadPct) : '…';
        const inFlight = !!(runtimeSnap && runtimeSnap.downloadInFlight);
        line = Number(pct) >= 100
          ? tx(inFlight ? 'paBuiltinEnabling' : 'paBuiltinDownloadNeedEnable', { pct })
          : tx('paBuiltinDownloading', { pct });
      } else line = tx('paBuiltinUnavailable');
    }
    if (status) {
      status.hidden = false;
      status.textContent = line;
    }
    if (download) {
      download.hidden = availability !== 'downloadable' && availability !== 'downloading';
      // 字节已下完但 availability 仍报 downloading：动作其实是「启用」，文案对齐以免用户以为要再下一次。
      const finishEnable = availability === 'downloading'
        && runtimeSnap && Number(runtimeSnap.downloadPct) >= 100;
      download.textContent = typeof tx === 'function'
        ? tx(finishEnable ? 'paBuiltinFinishEnable' : 'paBuiltinDownload')
        : (finishEnable ? '完成启用' : '下载模型');
    }
    const showCancel = availability === 'downloading'
      || (runtimeSnap && runtimeSnap.phase === 'downloading');
    if (cancel) cancel.hidden = !showCancel;
    void selectedRouteMode;
  }

  async function refreshBuiltinRoute(selectedRouteMode, opts) {
    const wrap = $('#popupLlmRouteBuiltinWrap');
    const status = $('#popupBuiltinStatus');
    const download = downloadBtn();
    const lm = globalThis.LanguageModel;
    const supported = !!(lm && typeof lm.availability === 'function'
      && typeof PageAdvisorBuiltinPrompt !== 'undefined');
    if (wrap) wrap.hidden = !supported;
    if (!supported || selectedRouteMode() !== 'builtin') {
      if (status) status.hidden = true;
      if (download) download.hidden = true;
      const basic = $('#popupBuiltinBasicMgmt');
      if (basic) basic.hidden = true;
      const popupOnly = $('#btnDownloadBuiltinModelPopup');
      if (popupOnly) popupOnly.hidden = true;
      return;
    }
    let availability = 'unavailable';
    try {
      availability = await PageAdvisorBuiltinPrompt.probe(lm, popupLocale());
    } catch (_) {
      availability = 'unavailable';
    }
    let runtimeSnap = null;
    if (typeof PageAdvisorBuiltinRuntime !== 'undefined' && PageAdvisorBuiltinRuntime.read) {
      try { runtimeSnap = await PageAdvisorBuiltinRuntime.read(); } catch (_) { runtimeSnap = null; }
    }
    if (typeof PageAdvisorBuiltinRuntime !== 'undefined' && PageAdvisorBuiltinRuntime.write) {
      try {
        const phase = typeof PageAdvisorBuiltinRuntime.phaseForSettingsProbe === 'function'
          ? PageAdvisorBuiltinRuntime.phaseForSettingsProbe(runtimeSnap, availability, {
            clearInFlight: !!(opts && opts.clearInFlight),
          })
          : 'idle';
        await PageAdvisorBuiltinRuntime.write({
          availability,
          language: (typeof PageAdvisorBuiltinPrompt.promptLanguage === 'function'
            ? PageAdvisorBuiltinPrompt.promptLanguage(popupLocale())
            : 'zh'),
          phase,
          ...((availability === 'available' || (opts && opts.clearInFlight))
            ? { downloadInFlight: false }
            : {}),
        });
        runtimeSnap = await PageAdvisorBuiltinRuntime.read();
      } catch (_) { /* ignore */ }
    }
    await applyBuiltinStatusFromProbe(availability, runtimeSnap, selectedRouteMode);
  }

  function onDownloadBuiltinModel(selectedRouteMode) {
    const run = async () => {
      const btn = downloadBtn();
      const status = $('#popupBuiltinStatus');
      setBusy(btn, true);
      if (status && typeof tx === 'function') {
        status.hidden = false;
        status.textContent = tx('paBuiltinDownloading', { pct: '0' });
      }
      try {
        await PageAdvisorBuiltinPrompt.startDownload(globalThis.LanguageModel, popupLocale(), {
          onProgress(pct) {
            if (status) {
              status.hidden = false;
              status.textContent = Number(pct) >= 100
                ? tx('paBuiltinEnabling', { pct })
                : tx('paBuiltinDownloading', { pct });
            }
          },
        });
        await refreshBuiltinRoute(selectedRouteMode);
      } catch (err) {
        if (status) {
          const base = tx('paBuiltinFailed');
          const detail = err && err.message ? String(err.message).slice(0, 160) : '';
          status.hidden = false;
          status.textContent = detail ? `${base} (${detail})` : base;
        }
      } finally {
        setBusy(btn, false);
      }
    };
    const pending = downloadGuard ? downloadGuard.run(run) : run();
    pending.catch(() => {});
    return pending;
  }

  function onCancelBuiltinDownload(selectedRouteMode) {
    const run = async () => {
      const status = $('#popupBuiltinStatus');
      const cancelled = (typeof PageAdvisorBuiltinPrompt !== 'undefined'
        && PageAdvisorBuiltinPrompt.cancelDownload)
        ? PageAdvisorBuiltinPrompt.cancelDownload()
        : false;
      if (!cancelled && status && typeof tx === 'function') {
        status.hidden = false;
        status.textContent = tx('paBuiltinNeedsDownload');
      }
      await refreshBuiltinRoute(selectedRouteMode);
    };
    const pending = cancelGuard ? cancelGuard.run(run) : run();
    pending.catch(() => {});
    return pending;
  }

  function onRefreshBuiltinStatus(selectedRouteMode) {
    const run = async () => {
      const status = $('#popupBuiltinStatus');
      const btn = $('#btnRefreshBuiltinStatus');
      setBusy(btn, true);
      if (status && typeof tx === 'function') {
        status.hidden = false;
        status.textContent = tx('paBuiltinRefreshing');
      }
      try {
        await refreshBuiltinRoute(selectedRouteMode, { clearInFlight: true });
      } finally {
        setBusy(btn, false);
      }
    };
    const pending = refreshGuard ? refreshGuard.run(run) : run();
    pending.catch(() => {});
    return pending;
  }

  function onOpenBuiltinFullMgmt() {
    try {
      window.parent.postMessage({ action: 'sidePanelShow', which: 'builtin' }, '*');
    } catch (_) { /* ignore */ }
    try {
      chrome.runtime.sendMessage({ action: 'sidePanelShow', which: 'builtin' }).catch(() => {});
    } catch (_) { /* ignore */ }
  }

  function watchBuiltinRuntime(selectedRouteMode) {
    if (runtimeUnsub) return;
    const onChanged = (changes, area) => {
      if (area !== 'session') return;
      const key = (typeof PageAdvisorBuiltinRuntime !== 'undefined' && PageAdvisorBuiltinRuntime.STORAGE_KEY)
        ? PageAdvisorBuiltinRuntime.STORAGE_KEY
        : 'pageAdvisorBuiltinRuntime';
      if (!changes || !changes[key]) return;
      const nv = changes[key].newValue;
      applyBuiltinStatusFromProbe(
        (nv && nv.availability) || 'unavailable',
        nv,
        selectedRouteMode,
      ).catch(() => {});
    };
    if (chrome.storage && chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
      chrome.storage.onChanged.addListener(onChanged);
      runtimeUnsub = () => chrome.storage.onChanged.removeListener(onChanged);
    }
  }

  function bindBuiltinMgmt(selectedRouteMode) {
    const download = $('#btnDownloadBuiltinModel');
    if (download) download.addEventListener('click', () => onDownloadBuiltinModel(selectedRouteMode));
    const downloadPopup = $('#btnDownloadBuiltinModelPopup');
    if (downloadPopup) downloadPopup.addEventListener('click', () => onDownloadBuiltinModel(selectedRouteMode));
    const refreshBtn = $('#btnRefreshBuiltinStatus');
    if (refreshBtn) refreshBtn.addEventListener('click', () => onRefreshBuiltinStatus(selectedRouteMode));
    const cancelBtn = $('#btnCancelBuiltinDownload');
    if (cancelBtn) cancelBtn.addEventListener('click', () => onCancelBuiltinDownload(selectedRouteMode));
    const openFull = $('#btnOpenBuiltinFullMgmt');
    if (openFull) openFull.addEventListener('click', () => { onOpenBuiltinFullMgmt(); });
    watchBuiltinRuntime(selectedRouteMode);
    if (!isSidepanelHost() && typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('pagehide', () => {
        if (typeof PageAdvisorBuiltinPrompt !== 'undefined' && PageAdvisorBuiltinPrompt.abandonEnable) {
          PageAdvisorBuiltinPrompt.abandonEnable();
        }
      });
    }
  }

  global.PopupBuiltinMgmt = {
    refreshBuiltinRoute,
    bindBuiltinMgmt,
    isSidepanelHost,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
