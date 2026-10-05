/**
 * 浏览器内置模型 suggest：按可观测子阶段计时（探测/建会话/裁剪/推理/解析）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.PageAdvisorBuiltinSuggest = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function pageAdvisorBuiltinSuggestFactory() {
  if (typeof PageAdvisorBuiltinLanguage === 'undefined' && typeof require === 'function') {
    try { require('./page-advisor-builtin-language.js'); } catch (_) { /* SW importScripts */ }
  }
  if (typeof PageAdvisorBuiltinFit === 'undefined' && typeof require === 'function') {
    try { require('./page-advisor-builtin-fit.js'); } catch (_) { /* SW importScripts */ }
  }
  if (typeof PageAdvisorHardwareTier === 'undefined' && typeof require === 'function') {
    try { require('./page-advisor-hardware-tier.js'); } catch (_) { /* SW importScripts */ }
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

  const resolveLanguageOptions = Lang.resolveLanguageOptions;
  const fitPrompt = Fit.fitPrompt;

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

  function bindSpan(opts) {
    if (opts && typeof opts.withSpan === 'function') {
      return (id, fn) => opts.withSpan(id, fn);
    }
    return (_id, fn) => fn();
  }

  // OPT-20261005-001: 合并流式片段。上游对 StreamingResponse 的约定历史上存在两种：
  // 累计文本（新片段以已累计前缀开头）与增量片段。两种都要能拼出完整结果。
  function appendStreamChunk(acc, chunk) {
    const piece = typeof chunk === 'string' ? chunk : (chunk == null ? '' : String(chunk));
    if (!piece) return acc;
    if (piece.length >= acc.length && piece.startsWith(acc)) return piece;
    return acc + piece;
  }

  // 读取 promptStreaming 返回的 ReadableStream，边读边回报已生成字数（onProgress）。
  async function readPromptStream(stream, onProgress) {
    let acc = '';
    const emit = () => { if (typeof onProgress === 'function') onProgress(acc.length); };
    if (stream && typeof stream.getReader === 'function') {
      const reader = stream.getReader();
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        acc = appendStreamChunk(acc, step.value);
        emit();
      }
      return acc;
    }
    if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
      for await (const chunk of stream) {
        acc = appendStreamChunk(acc, chunk);
        emit();
      }
      return acc;
    }
    throw new Error('builtin_stream_unsupported');
  }

  // OPT-20261005-002: 按硬件档位决定建议条数与上下文占比。
  const HW = typeof PageAdvisorHardwareTier !== 'undefined' ? PageAdvisorHardwareTier : {};

  function resolveHardwareTier(opts) {
    if (opts && opts.hardwareTier) {
      return typeof HW.normalizeTier === 'function' ? HW.normalizeTier(opts.hardwareTier) : String(opts.hardwareTier);
    }
    const nav = (typeof navigator !== 'undefined') ? navigator : null;
    return typeof HW.estimateTier === 'function' ? HW.estimateTier(nav) : 'mid';
  }

  async function suggest(languageModel, page, opts) {
    const span = bindSpan(opts);
    const tier = resolveHardwareTier(opts);
    const budget = typeof HW.budgetForTier === 'function' ? HW.budgetForTier(tier) : { budgetFactor: 0.65 };
    const responseSchema = typeof HW.schemaForTier === 'function'
      ? HW.schemaForTier(tier, SUGGESTION_SCHEMA)
      : SUGGESTION_SCHEMA;
    if (!languageModel || typeof languageModel.availability !== 'function' || typeof languageModel.create !== 'function') {
      const err = new Error('builtin_unavailable');
      err.code = 'builtin_unavailable';
      throw err;
    }

    let options;
    let availability;
    let extra = {};
    await span('builtin_probe', async () => {
      options = await resolveLanguageOptions(languageModel, opts && opts.locale);
      availability = await Lang.probeAvailability(languageModel, options);
      if (typeof languageModel.params === 'function') {
        try { extra = sampling(await languageModel.params()); } catch (_) { extra = {}; }
      }
    });

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

    const session = await span('builtin_create', () => languageModel.create({
      ...options,
      ...extra,
      signal: opts && opts.signal,
    }));
    try {
      const fitted = await span('builtin_fit', async () => {
        const measureFn = Fit.sessionMeasureFn(session);
        const measure = (text) => measureFn(text);
        const quotaRaw = session && Number.isFinite(Number(session.inputQuota))
          ? Number(session.inputQuota)
          : (session && Number.isFinite(Number(session.contextWindow)) ? Number(session.contextWindow) : Infinity);
        const quota = Fit.inputBudget(quotaRaw, budget.budgetFactor);
        return fitPrompt(page || {}, opts && opts.skill, opts && opts.locale, measure, quota);
      });

      const toText = Lang.coercePromptOutput || function (x) { return typeof x === 'string' ? x : String(x || ''); };
      const onInferProgress = opts && typeof opts.onInferProgress === 'function' ? opts.onInferProgress : null;
      // OPT-20261005-001: 优先流式（promptStreaming），边生成边回报已生成字数，
      // 缩短「卡住」感知；不可用时回退一次性 prompt。两级回退（带/不带
      // responseConstraint）保持不变。
      const inferOnce = async (withConstraint) => {
        const callOptions = withConstraint ? { ...options, responseConstraint: responseSchema } : options;
        if (typeof session.promptStreaming === 'function') {
          const stream = await session.promptStreaming(fitted.prompt, callOptions);
          return toText(await readPromptStream(stream, onInferProgress));
        }
        return toText(await session.prompt(fitted.prompt, callOptions));
      };
      const raw = await span('builtin_infer', async () => {
        try {
          return await inferOnce(true);
        } catch (first) {
          try {
            return await inferOnce(false);
          } catch (second) {
            const err = second || first;
            const wrapped = new Error(err && err.message ? err.message : 'builtin_prompt_failed');
            wrapped.code = classifyPromptError(err);
            throw wrapped;
          }
        }
      });

      const suggestions = await span('builtin_parse', async () => {
        if (typeof PageAdvisorLLM === 'undefined' || typeof PageAdvisorLLM.parseSuggestionsJSON !== 'function') {
          throw new Error('builtin_parse_missing');
        }
        let parsed = [];
        try {
          parsed = PageAdvisorLLM.parseSuggestionsJSON(raw, fitted.page.domOutline);
        } catch (_) {
          parsed = [];
        }
        if (!parsed.length) {
          const empty = new Error('builtin_empty');
          empty.code = 'builtin_empty';
          throw empty;
        }
        return parsed;
      });

      return { suggestions, skippedSkill: fitted.skippedSkill, usage: fitted.usage };
    } finally {
      if (session && typeof session.destroy === 'function') session.destroy();
    }
  }

  return {
    SUGGESTION_SCHEMA,
    resolveHardwareTier,
    sampling,
    classifyPromptError,
    suggest,
  };
});
