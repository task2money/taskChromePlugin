/**
 * 浏览器内置 Prompt API（LanguageModel）。
 * 语言选项只构造一次，availability / create / prompt 共用。
 * Alt+Z 在模型未下载完成时不调用 create；下载只由设置按钮发起。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.PageAdvisorBuiltinPrompt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function pageAdvisorBuiltinPromptFactory() {
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

  function promptLanguage(locale) {
    const normalize = typeof PageAdvisorLocalePrompt !== 'undefined' && PageAdvisorLocalePrompt.normalize
      ? PageAdvisorLocalePrompt.normalize
      : function fallback(value) {
        return String(value || '').toLowerCase().startsWith('en') ? 'en' : 'zh-CN';
      };
    return normalize(locale) === 'en' ? 'en' : 'zh';
  }

  function languageOptions(locale) {
    const language = promptLanguage(locale);
    return {
      expectedInputs: [{ type: 'text', languages: [language] }],
      expectedOutputs: [{ type: 'text', languages: [language] }],
    };
  }

  function isInteractive(node) {
    const tag = String(node && node.tag || '').toLowerCase();
    const role = String(node && node.role || '').toLowerCase();
    return tag === 'a' || tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select'
      || role === 'button' || role === 'link' || role === 'textbox';
  }

  function lastNonInteractive(outline) {
    for (let i = outline.length - 1; i >= 0; i -= 1) {
      if (!isInteractive(outline[i])) return i;
    }
    return -1;
  }

  function joinedPrompt(page, skill, locale) {
    if (typeof PageAdvisorLLM !== 'undefined' && typeof PageAdvisorLLM.buildChatMessages === 'function') {
      return PageAdvisorLLM.buildChatMessages(page, skill || null, locale).map((m) => m.content).join('\n');
    }
    return [page && page.pageText, skill && (skill.body || skill)].filter(Boolean).join('\n');
  }

  function shrinkPage(page, measure, quota) {
    const source = page || {};
    let text = String(source.pageText || '');
    let outline = Array.isArray(source.domOutline) ? source.domOutline.slice() : [];
    const next = () => ({ ...source, pageText: text, domOutline: outline });
    let guard = 0;
    while (measure(next()) > quota && guard < 64) {
      guard += 1;
      const chars = Array.from(text);
      if (chars.length > 400) {
        text = chars.slice(0, Math.floor(chars.length / 2)).join('');
        continue;
      }
      const drop = lastNonInteractive(outline);
      if (drop >= 0) {
        outline = outline.filter((_, i) => i !== drop);
        continue;
      }
      if (chars.length > 0) {
        text = chars.slice(0, Math.floor(chars.length / 2)).join('');
        continue;
      }
      break;
    }
    const pageOut = next();
    return { page: pageOut, usage: measure(pageOut) };
  }

  function fitPrompt(page, skill, locale, measureText, quota) {
    const fitted = shrinkPage(page, (p) => measureText(joinedPrompt(p, null, locale)), quota);
    const bare = joinedPrompt(fitted.page, null, locale);
    if (skill && measureText(joinedPrompt(fitted.page, skill, locale)) <= quota) {
      const prompt = joinedPrompt(fitted.page, skill, locale);
      return { page: fitted.page, prompt, skippedSkill: false, usage: measureText(prompt) };
    }
    return { page: fitted.page, prompt: bare, skippedSkill: !!skill, usage: measureText(bare) };
  }

  async function run(languageModel, locale, text) {
    if (!languageModel || typeof languageModel.availability !== 'function' || typeof languageModel.create !== 'function') {
      return { availability: 'unavailable', result: '' };
    }
    const options = languageOptions(locale);
    const availability = await languageModel.availability(options);
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
    return languageModel.availability(languageOptions(locale));
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

  async function suggest(languageModel, page, opts) {
    const options = languageOptions(opts && opts.locale);
    if (!languageModel || typeof languageModel.availability !== 'function' || typeof languageModel.create !== 'function') {
      const err = new Error('builtin_unavailable');
      err.code = 'builtin_unavailable';
      throw err;
    }
    const availability = await languageModel.availability(options);
    const canCreate = availability === 'available'
      || (opts && opts.allowCreate && (availability === 'downloadable' || availability === 'downloading'));
    if (!canCreate) {
      const err = new Error(availability === 'downloadable' || availability === 'downloading'
        ? 'builtin_needs_download'
        : 'builtin_unavailable');
      err.code = err.message;
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
      const measure = (text) => (session && typeof session.measureInputUsage === 'function'
        ? session.measureInputUsage(text)
        : String(text || '').length);
      const quota = session && Number.isFinite(Number(session.inputQuota)) ? Number(session.inputQuota) : Infinity;
      const fitted = fitPrompt(page || {}, opts && opts.skill, opts && opts.locale, measure, quota);
      let raw = '';
      try {
        raw = await session.prompt(fitted.prompt, { ...options, responseConstraint: SUGGESTION_SCHEMA });
      } catch (_) {
        raw = await session.prompt(fitted.prompt, options);
      }
      if (typeof PageAdvisorLLM === 'undefined' || typeof PageAdvisorLLM.parseSuggestionsJSON !== 'function') {
        throw new Error('builtin_parse_missing');
      }
      return {
        suggestions: PageAdvisorLLM.parseSuggestionsJSON(raw, fitted.page.domOutline),
        skippedSkill: fitted.skippedSkill,
        usage: fitted.usage,
      };
    } finally {
      if (session && typeof session.destroy === 'function') session.destroy();
    }
  }

  function watchDownload(monitor, onProgress) {
    if (!monitor || typeof monitor.addEventListener !== 'function' || typeof onProgress !== 'function') return;
    monitor.addEventListener('downloadprogress', (event) => {
      const loaded = Number(event && event.loaded) || 0;
      const total = Number(event && event.total) || 0;
      onProgress(total > 0 ? Math.floor((loaded / total) * 100) : 0);
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

  async function startDownload(languageModel, locale, hooks) {
    const options = languageOptions(locale);
    const availability = await languageModel.availability(options);
    if (availability !== 'downloadable' && availability !== 'downloading') {
      return { availability };
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
    await publishRuntime({
      phase: 'downloading',
      availability: 'downloading',
      downloadPct: 0,
      language: promptLanguage(locale),
    });
    try {
      const session = await languageModel.create({
        ...options,
        signal,
        monitor(monitor) {
          watchDownload(monitor, (pct) => {
            if (hooks && typeof hooks.onProgress === 'function') hooks.onProgress(pct);
            publishRuntime({
              phase: 'downloading',
              availability: 'downloading',
              downloadPct: pct,
            });
          });
        },
      });
      if (session && typeof session.destroy === 'function') session.destroy();
      await publishRuntime({
        phase: 'idle',
        availability: 'available',
        downloadPct: 100,
      });
      return { availability: 'available' };
    } catch (e) {
      const aborted = signal && signal.aborted;
      await publishRuntime({
        phase: aborted ? 'idle' : 'failed',
        availability: aborted ? 'downloadable' : 'downloading',
        lastErrorCode: aborted ? 'download_aborted' : 'download_failed',
        message: aborted ? '' : String(e && e.message || ''),
      });
      throw e;
    } finally {
      if (downloadAbort === controller) downloadAbort = null;
    }
  }

  function cancelDownload() {
    if (!downloadAbort) return false;
    try { downloadAbort.abort(); } catch (_) { /* ignore */ }
    downloadAbort = null;
    publishRuntime({
      phase: 'idle',
      availability: 'downloadable',
      lastErrorCode: 'download_aborted',
    });
    return true;
  }

  async function runAltZ(tabId, deps) {
    const notify = deps.notify;
    const tx = typeof deps.tx === 'function' ? deps.tx : (key) => key;
    const started = Date.now();
    await publishRuntime({ phase: 'collecting', availability: 'available', language: promptLanguage(deps.locale) });
    await notify(tabId, { ok: true, phase: 'loading', message: tx('paCollecting') });
    let ctxResp;
    try {
      ctxResp = await deps.askContext(tabId);
    } catch (e) {
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
    await publishRuntime({ phase: 'generating' });
    await notify(tabId, { ok: true, phase: 'loading', message: tx('paBuiltinGenerating') });
    let skill = null;
    if (typeof deps.loadSkill === 'function') {
      try { skill = await deps.loadSkill(); } catch (_) { skill = null; }
    }
    try {
      const out = await suggest(deps.languageModel, {
        url: data.url,
        title: data.title,
        pageText: data.pageText,
        domOutline: Array.isArray(data.domOutline) ? data.domOutline : [],
      }, { skill, locale: deps.locale, allowCreate: false });
      await publishRuntime({
        phase: 'done',
        availability: 'available',
        skippedSkill: !!out.skippedSkill,
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
      const error = code === 'builtin_needs_download' ? tx('paBuiltinNeedsDownload')
        : code === 'builtin_unavailable' ? tx('paBuiltinUnavailable')
        : tx('paBuiltinFailed');
      await publishRuntime({
        phase: 'failed',
        lastErrorCode: code || 'PLUGIN_BUILTIN_LLM_FAILED',
        message: error,
        durationMs: Date.now() - started,
        availability: code === 'builtin_needs_download' ? 'downloadable'
          : code === 'builtin_unavailable' ? 'unavailable' : undefined,
      });
      await notify(tabId, { ok: false, error, errorCode: code || 'PLUGIN_BUILTIN_LLM_FAILED' });
    }
  }

  return {
    promptLanguage,
    languageOptions,
    shrinkPage,
    fitPrompt,
    run,
    probe,
    suggest,
    startDownload,
    cancelDownload,
    runAltZ,
    publishRuntime,
  };
});
