/** 浏览器内置 Prompt API；未下载完成时 Alt+Z 不 create。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.PageAdvisorBuiltinPrompt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function pageAdvisorBuiltinPromptFactory() {
  if (typeof PageAdvisorBuiltinLanguage === 'undefined' && typeof require === 'function') {
    try { require('./page-advisor-builtin-language.js'); } catch (_) { /* SW importScripts */ }
  }
  if (typeof PageAdvisorBuiltinFit === 'undefined' && typeof require === 'function') {
    try { require('./page-advisor-builtin-fit.js'); } catch (_) { /* SW importScripts */ }
  }
  const Lang = typeof PageAdvisorBuiltinLanguage !== 'undefined' ? PageAdvisorBuiltinLanguage : {};
  const Fit = typeof PageAdvisorBuiltinFit !== 'undefined' ? PageAdvisorBuiltinFit : {};
  const SUGGESTION_SCHEMA = {
    type: 'array',
    maxItems: 8,
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string' },
        detail: { type: 'string' },
        category: { type: 'string' },
        target_nid: { type: 'string' },
        anchor_text: { type: 'string' },
      },
      required: ['id', 'title', 'summary'],
    },
  };

  const promptLanguage = Lang.promptLanguage;
  const languageOptions = Lang.languageOptions;
  const resolveLanguageOptions = Lang.resolveLanguageOptions;
  const shrinkPage = Fit.shrinkPage;
  const fitPrompt = Fit.fitPrompt;

  async function run(languageModel, locale, text) {
    if (!languageModel || typeof languageModel.availability !== 'function' || typeof languageModel.create !== 'function') {
      return { availability: 'unavailable', result: '' };
    }
    const options = await resolveLanguageOptions(languageModel, locale);
    const availability = await Lang.probeAvailability(languageModel, options);
    if (availability !== 'available') {
      return { availability, result: '', options };
    }
    const session = await languageModel.create(options);
    try {
      const result = typeof session.prompt === 'function' ? await session.prompt(text, options) : '';
      return { availability, result, options };
    } finally {
      if (session && typeof session.destroy === 'function') session.destroy();
    }
  }

  async function probe(languageModel, locale) {
    if (!languageModel || typeof languageModel.availability !== 'function') return 'unavailable';
    const options = await resolveLanguageOptions(languageModel, locale);
    return Lang.probeAvailability(languageModel, options);
  }

  function sampling(params) {
    if (!params) return {};
    const maxT = Number(params.maxTemperature);
    const topK = params.defaultTopK;
    const out = {};
    if (Number.isFinite(maxT)) out.temperature = Math.min(0.3, maxT);
    if (topK != null) out.topK = topK;
    return out;
  }

  function classifyPromptError(e) {
    const name = String(e && e.name || '');
    const msg = String(e && e.message || '');
    if (name === 'QuotaExceededError' || /quota/i.test(msg)) return 'builtin_quota';
    return e && e.code ? e.code : 'PLUGIN_BUILTIN_LLM_FAILED';
  }

  async function suggest(languageModel, page, opts) {
    if (!languageModel || typeof languageModel.availability !== 'function' || typeof languageModel.create !== 'function') {
      const err = new Error('builtin_unavailable');
      err.code = 'builtin_unavailable';
      throw err;
    }
    const options = await resolveLanguageOptions(languageModel, opts && opts.locale);
    const availability = await Lang.probeAvailability(languageModel, options);
    const canCreate = availability === 'available'
      || (opts && opts.allowCreate && (availability === 'downloadable' || availability === 'downloading'));
    if (!canCreate) {
      const code = availability === 'downloading'
        ? 'builtin_downloading'
        : availability === 'downloadable'
          ? 'builtin_needs_download'
          : 'builtin_unavailable';
      const err = new Error(code);
      err.code = code;
      err.availability = availability;
      throw err;
    }
    let extra = {};
    if (typeof languageModel.params === 'function') {
      try { extra = sampling(await languageModel.params()); } catch (_) { extra = {}; }
    }
    const session = await languageModel.create({
      ...options,
      ...extra,
      signal: opts && opts.signal,
    });
    try {
      const measureFn = Fit.sessionMeasureFn(session);
      const measure = (text) => measureFn(text);
      const quotaRaw = session && Number.isFinite(Number(session.inputQuota))
        ? Number(session.inputQuota)
        : (session && Number.isFinite(Number(session.contextWindow)) ? Number(session.contextWindow) : Infinity);
      const quota = Fit.inputBudget(quotaRaw);
      const fitted = await fitPrompt(page || {}, opts && opts.skill, opts && opts.locale, measure, quota);
      const toText = Lang.coercePromptOutput || function (x) { return typeof x === 'string' ? x : String(x || ''); };
      let raw = '';
      try {
        raw = toText(await session.prompt(fitted.prompt, { ...options, responseConstraint: SUGGESTION_SCHEMA }));
      } catch (first) {
        try {
          raw = toText(await session.prompt(fitted.prompt, options));
        } catch (second) {
          const err = second || first;
          const wrapped = new Error(err && err.message ? err.message : 'builtin_prompt_failed');
          wrapped.code = classifyPromptError(err);
          throw wrapped;
        }
      }
      if (typeof PageAdvisorLLM === 'undefined' || typeof PageAdvisorLLM.parseSuggestionsJSON !== 'function') {
        throw new Error('builtin_parse_missing');
      }
      let suggestions = [];
      try {
        suggestions = PageAdvisorLLM.parseSuggestionsJSON(raw, fitted.page.domOutline);
      } catch (_) {
        suggestions = [];
      }
      if (!suggestions.length) {
        const empty = new Error('builtin_empty');
        empty.code = 'builtin_empty';
        throw empty;
      }
      return { suggestions, skippedSkill: fitted.skippedSkill, usage: fitted.usage };
    } finally {
      if (session && typeof session.destroy === 'function') session.destroy();
    }
  }

  function progressPercent(event) {
    const loaded = Number(event && event.loaded);
    const total = Number(event && event.total);
    if (!Number.isFinite(loaded) || loaded < 0) return 0;
    // Chrome Prompt API：loaded 常为 0..1；MDN 示例亦可能带 total。
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

  async function publishRuntime(patch) {
    if (typeof PageAdvisorBuiltinRuntime === 'undefined' || typeof PageAdvisorBuiltinRuntime.write !== 'function') {
      return null;
    }
    try {
      return await PageAdvisorBuiltinRuntime.write(patch);
    } catch (_) {
      return null;
    }
  }

  let downloadAbort = null;

  // OPT-20261003-019: 跨上下文取消，仅 owner AbortController 执行 abort。
  const DOWNLOAD_CANCEL_MESSAGE = 'builtinDownloadCancel';
  const CONTEXT_ID = 'dl-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  let cancelRelayHost = null;

  function onRelayCancel(message) {
    if (!message || message.type !== DOWNLOAD_CANCEL_MESSAGE) return;
    // 仅 owner（本地仍持有 AbortController）执行 abort；其余上下文忽略。
    if (!downloadAbort) return;
    abortOwnDownload('download_aborted');
  }

  function installCancelRelay() {
    if (typeof chrome === 'undefined' || !chrome.runtime
      || !chrome.runtime.onMessage || typeof chrome.runtime.onMessage.addListener !== 'function') {
      return;
    }
    // 同一宿主只装一次；测试里换 chrome 对象后可重新安装。
    if (cancelRelayHost === chrome.runtime.onMessage) return;
    cancelRelayHost = chrome.runtime.onMessage;
    chrome.runtime.onMessage.addListener(onRelayCancel);
  }

  function broadcastCancel() {
    if (typeof chrome === 'undefined' || !chrome.runtime
      || typeof chrome.runtime.sendMessage !== 'function') {
      return false;
    }
    try {
      chrome.runtime.sendMessage({
        action: DOWNLOAD_CANCEL_MESSAGE,
        type: DOWNLOAD_CANCEL_MESSAGE,
        ownerId: '',
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  function abortOwnDownload(errorCode) {
    if (!downloadAbort) return false;
    const ctrl = downloadAbort;
    downloadAbort = null;
    try { ctrl.abort(); } catch (_) { /* ignore */ }
    publishRuntime({
      phase: 'idle',
      availability: 'downloadable',
      downloadInFlight: false,
      lastErrorCode: errorCode || 'download_aborted',
      enableOwner: '',
    });
    return true;
  }

  async function startDownload(languageModel, locale, hooks) {
    // Chrome Prompt API：首次下载必须在用户激活窗口内调用 create()。
    // 任何在 create 之前的 await（availability / storage）都会丢掉激活态，
    // 表现为侧栏「下载模型」点击无反响（NotAllowedError 被上层吞掉）。
    const options = (Lang.cachedLanguageOptions
      ? Lang.cachedLanguageOptions(locale)
      : languageOptions(locale));
    if (!languageModel || typeof languageModel.create !== 'function') {
      return { availability: 'unavailable' };
    }
    if (downloadAbort) {
      try { downloadAbort.abort(); } catch (_) { /* ignore */ }
    }
    const controller = (hooks && hooks.signal && typeof AbortController === 'undefined')
      ? null
      : new AbortController();
    if (hooks && hooks.signal && controller) {
      hooks.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    downloadAbort = controller;
    const signal = (hooks && hooks.signal) || (controller && controller.signal);
    // 不 await：避免在 create 前 yield 微任务/宏任务导致用户激活失效
    const timeoutMs = Number(hooks && hooks.enableTimeoutMs);
    const enableMs = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : (typeof PageAdvisorBuiltinRuntime !== 'undefined' && PageAdvisorBuiltinRuntime.ENABLE_STALE_MS)
        ? PageAdvisorBuiltinRuntime.ENABLE_STALE_MS
        : 180000;
    let hundredTimer = null;
    let hundredMarked = false;
    installCancelRelay();
    const kickoff = publishRuntime({
      phase: 'downloading',
      availability: 'downloading',
      downloadPct: 0,
      downloadInFlight: true,
      enableStartedAt: Date.now(),
      // OPT-20261003-019: 登记 owner 上下文，便于其他上下文广播取消时定位。
      enableOwner: CONTEXT_ID,
      language: promptLanguage(locale),
    });
    if (typeof PageAdvisorBuiltinRuntime !== 'undefined'
      && typeof PageAdvisorBuiltinRuntime.scheduleEnableWatchdog === 'function') {
      PageAdvisorBuiltinRuntime.scheduleEnableWatchdog();
    }
    try {
      const session = await languageModel.create({
        ...options,
        signal,
        monitor(monitor) {
          watchDownload(monitor, (pct) => {
            if (hooks && typeof hooks.onProgress === 'function') hooks.onProgress(pct);
            const patch = {
              phase: 'downloading',
              availability: 'downloading',
              downloadPct: pct,
              downloadInFlight: true,
            };
            if (pct >= 100 && !hundredMarked) {
              hundredMarked = true;
              patch.enableHundredAt = Date.now();
              if (controller) {
                hundredTimer = setTimeout(() => {
                  try { controller.abort(); } catch (_) { /* ignore */ }
                }, enableMs);
              }
            }
            publishRuntime(patch);
          });
        },
      });
      if (session && typeof session.destroy === 'function') session.destroy();
      await publishRuntime({
        phase: 'idle',
        availability: 'available',
        downloadPct: 100,
        downloadInFlight: false,
        lastErrorCode: '',
        message: '',
        enableOwner: '',
      });
      return { availability: 'available' };
    } catch (e) {
      const aborted = signal && signal.aborted;
      await publishRuntime({
        phase: aborted ? 'idle' : 'failed',
        // 失败后回到 downloadable，避免 UI 仍显示「取消下载」但 abort 控制器已清空
        availability: 'downloadable',
        downloadInFlight: false,
        lastErrorCode: aborted ? 'download_aborted' : 'download_failed',
        message: aborted ? '' : String(e && e.message || ''),
        enableOwner: '',
      });
      throw e;
    } finally {
      if (hundredTimer) {
        try { clearTimeout(hundredTimer); } catch (_) { /* ignore */ }
      }
      try { await kickoff; } catch (_) { /* ignore */ }
      if (downloadAbort === controller) downloadAbort = null;
    }
  }

  function cancelDownload() {
    // OPT-20261003-019: 本上下文是 owner → 直接 abort；否则广播让 owner 处理。
    if (downloadAbort) return abortOwnDownload('download_aborted');
    return broadcastCancel();
  }

  function abandonEnable() {
    if (downloadAbort) return abortOwnDownload('enable_orphaned');
    return false;
  }

  async function runAltZ(tabId, deps) {
    const notify = deps.notify;
    const tx = typeof deps.tx === 'function' ? deps.tx : (key) => key;
    const started = Date.now();
    await publishRuntime({ phase: 'collecting', availability: 'available', language: promptLanguage(deps.locale) });
    await notify(tabId, { ok: true, phase: 'loading', message: tx('paCollecting') });
    let ctxResp;
    const timeoutMs = Number(deps.askContextTimeoutMs);
    const waitMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 12000;
    try {
      const pending = deps.askContext(tabId);
      ctxResp = (typeof globalThis.withTimeout === 'function')
        ? await globalThis.withTimeout(pending, waitMs, 'getPageAdvisorContext')
        : await pending;
    } catch (e) {
      console.warn('[taskChromePlugin] builtin askContext failed', {
        tabId,
        error: e && e.message,
      });
      await publishRuntime({
        phase: 'failed',
        lastErrorCode: 'PLUGIN_BUILTIN_CONTEXT',
        message: tx('paContextReadFailed'),
        durationMs: Date.now() - started,
      });
      await notify(tabId, { ok: false, error: tx('paContextReadFailed'), errorCode: 'PLUGIN_BUILTIN_CONTEXT' });
      return;
    }
    if (!ctxResp || !ctxResp.success || !ctxResp.data) {
      await publishRuntime({
        phase: 'failed',
        lastErrorCode: 'PLUGIN_BUILTIN_CONTEXT',
        message: tx('paContextUnavailable'),
        durationMs: Date.now() - started,
      });
      await notify(tabId, {
        ok: false,
        error: tx('paContextUnavailable'),
        errorCode: 'PLUGIN_BUILTIN_CONTEXT',
      });
      return;
    }
    const data = ctxResp.data;
    const Enable = typeof PageAdvisorBuiltinEnable !== 'undefined' ? PageAdvisorBuiltinEnable : null;
    if (Enable && typeof Enable.waitIfEnabling === 'function') {
      await Enable.waitIfEnabling(deps.languageModel, deps.locale, tabId, { ...deps, probe });
    }
    await publishRuntime({ phase: 'generating' });
    await notify(tabId, { ok: true, phase: 'loading', message: tx('paBuiltinGenerating') });
    let skill = null;
    if (typeof deps.loadSkill === 'function') {
      try { skill = await deps.loadSkill(); } catch (_) { skill = null; }
    }
    try {
      const infer = (fn) => (typeof deps.withSpan === 'function' ? deps.withSpan('builtin', fn) : fn());
      const out = await infer(() => suggest(deps.languageModel, {
        url: data.url,
        title: data.title,
        pageText: data.pageText,
        domOutline: Array.isArray(data.domOutline) ? data.domOutline : [],
      }, { skill, locale: deps.locale, allowCreate: false }));
      await publishRuntime({
        phase: 'done',
        availability: 'available',
        skippedSkill: !!out.skippedSkill,
        lastErrorCode: '',
        lastOkAt: Date.now(),
        durationMs: Date.now() - started,
        message: out.skippedSkill ? tx('paBuiltinSkippedSkill') : '',
      });
      await notify(tabId, {
        ok: true,
        phase: 'done',
        jobId: '',
        pageUrl: String(data.url || ''),
        suggestions: out.suggestions,
        featureParamsSource: 'plugin_builtin',
        message: out.skippedSkill ? tx('paBuiltinSkippedSkill') : '',
      });
    } catch (e) {
      const code = e && e.code;
      const av = e && e.availability;
      const gate = code === 'builtin_needs_download' || code === 'builtin_downloading';
      const patch = {
        lastErrorCode: code || 'PLUGIN_BUILTIN_LLM_FAILED',
        durationMs: Date.now() - started,
      };
      if (gate) {
        patch.phase = av === 'downloading' ? 'downloading' : 'idle';
        patch.availability = av === 'downloading' ? 'downloading' : 'downloadable';
        patch.message = '';
      } else {
        patch.phase = 'failed';
        patch.skippedSkill = false;
        patch.availability = code === 'builtin_unavailable' ? 'unavailable' : undefined;
      }
      const snap = await publishRuntime(patch);
      let error;
      if (gate && typeof PageAdvisorBuiltinRuntime !== 'undefined'
        && typeof PageAdvisorBuiltinRuntime.statusLineForSettings === 'function') {
        error = PageAdvisorBuiltinRuntime.statusLineForSettings({ ...(snap || {}), ...patch }, tx);
      } else if (code === 'builtin_needs_download') {
        error = tx('paBuiltinNeedsDownload');
      } else if (code === 'builtin_downloading') {
        const pct = snap && snap.downloadPct != null ? String(snap.downloadPct) : '…';
        error = Number(pct) >= 100
          ? tx((snap && snap.downloadInFlight) ? 'paBuiltinEnabling' : 'paBuiltinDownloadNeedEnable', { pct })
          : tx('paBuiltinDownloading', { pct });
      } else if (code === 'builtin_unavailable') {
        error = tx('paBuiltinUnavailable');
      } else if (code === 'builtin_empty') {
        error = tx('paEmpty');
      } else {
        error = tx('paBuiltinFailed');
      }
      if (!gate) {
        await publishRuntime({ message: error });
      }
      console.warn('[taskChromePlugin] builtin shortcut blocked', {
        code: code || 'PLUGIN_BUILTIN_LLM_FAILED',
        availability: av || patch.availability,
        downloadPct: snap && snap.downloadPct,
      });
      await notify(tabId, { ok: false, error, errorCode: code || 'PLUGIN_BUILTIN_LLM_FAILED' });
    }
  }

  return {
    promptLanguage,
    languageOptions,
    resolveLanguageOptions,
    shrinkPage,
    fitPrompt,
    run,
    probe,
    suggest,
    startDownload,
    cancelDownload,
    abandonEnable,
    progressPercent,
    runAltZ,
    publishRuntime,
  };
});
