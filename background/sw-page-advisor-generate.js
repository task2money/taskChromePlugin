/**
 * 生成建议的核心：为某个标签页跑完「取页面 → 提交平台 → 出建议」。
 *
 * 两个出口共用它：Alt+Z 把结果画到页面上（`background/sw-page-advisor.js`），
 * 侧边栏「给当前网页生成建议」把结果落成优化贴（`background/sw-agent-suggestions.js`）。
 * 失败一律以 `{ ok: false, error, errorCode, traceId }` 返回，不直接通知谁——
 * 通知是各出口自己的事，核心只负责生成。
 */

'use strict';

// 与 conf/ai/task-page-advisor upstreamTimeoutSec(60s) + 排队开销对齐。
// 现网成功 job 常见 17–27s；15s 客户端上限会在 LLM 仍成功时误报超时。
const PAGE_ADVISOR_POLL_MAX_MS = 75000;
const PAGE_ADVISOR_POLL_MAX_SEC = Math.round(PAGE_ADVISOR_POLL_MAX_MS / 1000);

function agentResourceNotConfiguredMessage(baseUrl, tenantId) {
  const origin = String(baseUrl || '').replace(/\/+$/, '');
  const tenantPath = tenantId
    ? `${origin}/tenant/${encodeURIComponent(tenantId)}/settings/feature-params/`
    : `${origin}/tenant/settings/feature-params/`;
  const personalPath = `${origin}/profile/feature-params/`;
  return {
    errorCode: 'AGENT_RESOURCE_NOT_CONFIGURED',
    message: tx('paNoAgentResource'),
    links: [
      { label: tx('paTenantSettingsLabel'), href: tenantPath },
      { label: tx('paPersonalCenterLabel'), href: personalPath },
    ],
  };
}

function autoInnovateQuotaExceededMessage(baseUrl, tenantId) {
  const origin = String(baseUrl || '').replace(/\/+$/, '');
  const orderPath = tenantId
    ? `${origin}/tenant/${encodeURIComponent(tenantId)}/billing/orders/create/`
    : `${origin}/pricing/`;
  return {
    errorCode: 'AUTO_INNOVATE_QUOTA_EXCEEDED',
    message: tx('paQuotaExhausted'),
    links: [
      { label: tx('paBuyCredits'), href: orderPath },
      { label: tx('paViewPricing'), href: `${origin}/pricing/` },
    ],
  };
}

// OPT-20261006-023: 系统智能体 SKU 次数用尽 —— 引导到设置页购买该系统智能体，而非自有转发次数。
function sysAutoInnovateQuotaExceededMessage(baseUrl, tenantId) {
  const origin = String(baseUrl || '').replace(/\/+$/, '');
  const settingsPath = tenantId
    ? `${origin}/tenant/${encodeURIComponent(tenantId)}/settings/feature-params/`
    : `${origin}/tenant/settings/feature-params/`;
  return {
    errorCode: 'SYS_AUTO_INNOVATE_QUOTA_EXCEEDED',
    message: tx('paSysQuotaExhausted'),
    links: [
      { label: tx('paBuySystemAgent'), href: settingsPath },
      { label: tx('paViewPricing'), href: `${origin}/pricing/` },
    ],
  };
}

function pageAdvisorFailTraceId(seed) {
  const given = String(seed || '').trim();
  if (given) return given;
  if (typeof APIHttp !== 'undefined' && APIHttp.newRequestTraceId) {
    return String(APIHttp.newRequestTraceId() || '').trim();
  }
  return `page-advisor-${Date.now()}`;
}

function passthroughSpan(_id, fn) { return fn(); }

/**
 * 进度上报器：回调缺失或抛错都吞掉——进度只是体验，不能拖垮生成。
 * 事件形状 `{ stage, percent }`，阶段定义见 lib/agent-suggestions-progress.js。
 * @param {{ onProgress?: (event: object) => void|Promise<void> }} opts
 * @returns {(stage: string, percent: number, extra?: object) => void}
 */
function progressReporter(opts) {
  const onProgress = opts && typeof opts.onProgress === 'function' ? opts.onProgress : null;
  return function report(stage, percent, extra) {
    if (!onProgress) return;
    const event = Object.assign({ stage, percent }, extra && typeof extra === 'object' ? extra : {});
    try {
      const pending = onProgress(event);
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch (_e) {
      /* 进度上报失败绝不影响生成 */
    }
  };
}

/**
 * 本次生成要用的提示词 id：显式给的优先，其次侧栏记住的选择，最后空串交给服务端默认。
 * 只读 id，不碰提示词正文——正文由服务端按 id 解析，下发 job 里也不回传正文。
 * @param {string|undefined} rawId
 * @returns {Promise<string>}
 */
async function resolvePageAdvisorPromptSkillId(rawId) {
  const explicit = String(rawId ?? '').trim();
  if (explicit) return explicit;
  const Options = typeof PageAdvisorPromptOptions !== 'undefined' ? PageAdvisorPromptOptions : null;
  if (!Options || typeof Options.loadSelectedId !== 'function') return '';
  try {
    return String(await Options.loadSelectedId() || '').trim();
  } catch (e) {
    // 读记住的选择失败不该拖垮整次生成：退回服务端默认提示词。
    console.warn('[taskChromePlugin] load selected prompt skill:', e?.message || e);
    return '';
  }
}

/**
 * @param {number} tabId
 * @param {{
 *   onPhase?: (message: string) => void|Promise<void>,
 *   onProgress?: (event: { stage: string, percent: number }) => void|Promise<void>,
 *   withSpan?: (id: string, fn: () => Promise<any>) => Promise<any>,
 *   onLlmSpan?: (id: string, startAbs: number, endAbs: number, status: string) => void,
 *   attachAnchors?: boolean,
 *   promptSkillId?: string,
 * }} [opts]
 * @returns {Promise<{ ok: true, pageUrl: string, pageTitle: string, suggestions: any[],
 *   jobId: string, featureParamsSource: string, traceId: string,
 *   tenantId?: string, workspaceId?: string, promptSkillId?: string,
 *   promptFallback?: boolean }
 *   | { ok: false, error: string, errorCode: string, traceId: string, links?: any[] }>}
 */
async function generatePageAdvisorSuggestions(tabId, opts = {}) {
  const withSpan = typeof opts.withSpan === 'function' ? opts.withSpan : passthroughSpan;
  const onPhase = typeof opts.onPhase === 'function' ? opts.onPhase : () => {};
  const report = progressReporter(opts);

  const cfg = await Storage.getApiConfig();
  const mapping = await Storage.getEndpointMapping();
  const cred = await Storage.getCredentials();
  const expired = cfg.token ? await Storage.isTokenExpired() : false;
  const sessionOk = !!(cfg.token && !expired);

  // 未登录走匿名每日试用（服务端按指纹 + IP + 全局池记账）；登录后走平台后端。
  // 试用要采集页面上下文后才能提交，故这里不提前返回。
  const trialMode = !sessionOk;
  if (sessionOk) {
    API.init(cfg.baseUrl, cfg.token, mapping, cred.userId || '');
    if (mapping.owner) API.setOwner(mapping.owner);
  }

  report('capture', 8);
  await onPhase(tx('paCollecting'));
  let ctxResp;
  try {
    ctxResp = await withSpan('capture', () => askContentPageAdvisorContext(tabId));
  } catch (e) {
    return { ok: false, error: e?.message || tx('paContextReadFailed'), errorCode: '', traceId: '' };
  }
  if (!ctxResp?.success || !ctxResp.data) {
    // errorCode 透传：侧边栏/内容层据此区分「刷新页面即可」与「页面类型不支持」。
    return {
      ok: false,
      error: ctxResp?.error || tx('paContextUnavailable'),
      errorCode: ctxResp?.errorCode || '',
      traceId: '',
    };
  }

  const data = ctxResp.data;
  const locale = resolvePageAdvisorLocale();
  const page = {
    url: String(data.url || ''),
    title: String(data.title || ''),
    pageText: String(data.pageText || ''),
    domOutline: Array.isArray(data.domOutline) ? data.domOutline : [],
  };
  const selectedPromptId = await resolvePageAdvisorPromptSkillId(opts.promptSkillId);

  const runOnce = async (promptSkillId) => {
    if (trialMode) {
      return generateViaPageTrial({ cfg, page, locale, opts, withSpan, onPhase, promptSkillId, report });
    }
    return generateViaPlatform({ tabId, cfg, data, page, locale, opts, withSpan, onPhase, promptSkillId, report });
  };

  let result = await runOnce(selectedPromptId);
  // 服务端不认这个提示词（目录被删/跨空间选错）时回退服务端默认提示词，只重试一次。
  // 没有发过 id 时重试也不会改变结果，故不重试。
  if (!result.ok && result.errorCode === 'invalid_prompt_skill' && selectedPromptId) {
    console.warn('[taskChromePlugin] page_advisor_prompt_invalid_fallback', {
      promptSkillId: selectedPromptId,
      tabId,
    });
    result = await runOnce('');
    if (result && typeof result === 'object') result.promptFallback = true;
  }
  return result;
}

async function generateViaPlatform({ tabId, cfg, data, page, locale, opts, withSpan, onPhase, promptSkillId, report }) {
  report('submit', 16);
  const scope = await resolvePlatformScope(data);
  if (!scope.workspaceId || !scope.tenantId) {
    return { ok: false, error: tx('paSelectWorkspaceAltZ'), errorCode: '', traceId: '' };
  }

  let screenshotUrl = '';
  try {
    screenshotUrl = await capturePageAdvisorScreenshotHook(tabId);
  } catch (e) {
    console.warn('[taskChromePlugin] page advisor screenshot hook skipped:', e?.message || e);
  }

  const idempotencyKey = (typeof ClickGuard !== 'undefined' && ClickGuard.newIdempotencyKey)
    ? ClickGuard.newIdempotencyKey()
    : `page-advisor-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  const body = await withSpan('prompt', async () => ({
    workspace_id: scope.workspaceId,
    page_url: page.url,
    page_title: page.title,
    page_text: page.pageText,
    screenshot_url: screenshotUrl || '',
    dom_outline: page.domOutline,
    locale,
    // 提示词正文由服务端按 id 解析；空串 = 服务端默认提示词。
    prompt_skill_id: String(promptSkillId || '').trim(),
  }));

  let created;
  try {
    created = await withSpan('network', () => PageAdvisorAPI.createSuggestJob(scope.tenantId, body, idempotencyKey));
  } catch (e) {
    report('failed', 100);
    return platformCreateFailure(e, cfg.baseUrl, scope.tenantId);
  }
  let createTraceId = String(created?.trace_id || created?.traceId || created?._resolvedTraceId || '').trim();
  if (!createTraceId) createTraceId = pageAdvisorFailTraceId('');

  const jobId = String(created?.job_id || created?.id || '').trim();
  if (!jobId) {
    report('failed', 100);
    return { ok: false, error: tx('paNoJobId'), errorCode: '', traceId: createTraceId };
  }

  const createdStatus = String(created?.status || '').trim().toLowerCase();
  report(createdStatus === 'running' ? 'generating' : 'queued', createdStatus === 'running' ? 35 : 25);

  let job;
  try {
    job = await withSpan('saas_poll', () => PageAdvisorAPI.pollSuggestJob(scope.tenantId, jobId, {
      maxMs: PAGE_ADVISOR_POLL_MAX_MS,
      seedTraceId: createTraceId,
      // 每次 GET 回报 job 状态与已耗时：侧栏据此把「排队 / 生成」换算成百分比。
      onPoll: (snap, meta) => {
        const Progress = typeof AgentSuggestionsProgress !== 'undefined' ? AgentSuggestionsProgress : null;
        const status = String(snap?.status || '');
        const stage = Progress ? Progress.stageForJobStatus(status) : 'generating';
        const percent = Progress
          ? Progress.percentForPoll({ status, elapsedMs: meta && meta.elapsedMs })
          : 40;
        report(stage, percent);
      },
    }));
  } catch (e) {
    report('failed', 100);
    const timedOut = /timeout|超时|timed?\s*out/i.test(String(e?.message || e?.errorCode || ''));
    const traceId = String(e?.traceId || createTraceId || '').trim() || pageAdvisorFailTraceId('');
    return {
      ok: false,
      error: timedOut
        ? tx('paPollTimeout', { sec: PAGE_ADVISOR_POLL_MAX_SEC })
        : (e?.message || tx('paPollFailed')),
      errorCode: timedOut ? 'PAGE_ADVISOR_TIMEOUT' : (e?.errorCode || ''),
      // 请求失败 UI 必须带 data-traceId（约束 24）；超时路径禁止空串。
      traceId,
    };
  }

  if (job && globalThis.PageAdvisorTiming && PageAdvisorTiming.applySaasForward
    && typeof opts.onSaasForward === 'function') {
    opts.onSaasForward(job.llm_forward);
  }

  const status = String(job?.status || '').toLowerCase();
  if (status === 'failed' || status === 'expired') {
    report('failed', 100);
    // LLM 402 Insufficient Balance 等失败也须带 data-traceId（约束 24）。
    const failTraceId = PageAdvisorFailTraceId.resolvePageAdvisorFailTraceId(job, createTraceId);
    if (job?.error_code === 'AGENT_RESOURCE_NOT_CONFIGURED') {
      return { ok: false, ...agentResourceNotConfiguredMessage(cfg.baseUrl, scope.tenantId), traceId: failTraceId };
    }
    return {
      ok: false,
      error: job?.error_message || tx('paGenerateFailed'),
      errorCode: job?.error_code || '',
      traceId: failTraceId,
    };
  }

  // 模型已出结果，剩解析与落贴：进度到 95%，完成由落贴出口补 100%。
  report('posting', 95);

  let suggestions = job?.suggestions;
  await withSpan('parse', async () => {
    if (typeof suggestions === 'string') {
      try { suggestions = JSON.parse(suggestions); } catch (_) { suggestions = []; }
    }
    if (!Array.isArray(suggestions)) {
      suggestions = Array.isArray(job?.suggestions_json) ? job.suggestions_json : [];
    }
    if (typeof attachSuggestionAnchors === 'function') {
      suggestions = attachSuggestionAnchors(suggestions, page.domOutline);
    }
  });

  return {
    ok: true,
    route: 'saas',
    pageUrl: body.page_url,
    pageTitle: page.title,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    suggestions,
    jobId,
    promptSkillId: String(promptSkillId || '').trim(),
    featureParamsSource: job?.feature_params_source || '',
    traceId: createTraceId,
  };
}

/** 下发账号：租户/工作空间来自页面上下文，缺了就用上一次选过的。 */
async function resolvePlatformScope(data) {
  let workspaceId = String(data.workspaceId || '').trim();
  let tenantId = String(data.companyId || data.tenantId || '').trim();
  if (!workspaceId || !tenantId) {
    let workspaces = [];
    try {
      const list = await API.getWorkspaces();
      workspaces = Array.isArray(list) ? list : (list?.results || list?.items || list?.data || []);
    } catch (e) {
      console.warn('[taskChromePlugin] page advisor getWorkspaces for defaults:', e?.message || e);
    }
    const lastWorkspaceId = await Storage.getLastWorkspace();
    // OPT-20261014-037：从未选过（或只被插件自动选中）时改用平台默认工作空间，
    // 否则首次 Alt+Z 会要求用户先打开弹窗选空间。
    const lastWorkspaceManual = await Storage.getLastWorkspaceManual();
    const resolved = (typeof PageAdvisorDefaults !== 'undefined'
      && PageAdvisorDefaults.resolvePageAdvisorWorkspace)
      ? PageAdvisorDefaults.resolvePageAdvisorWorkspace({
        floatWorkspaceId: workspaceId,
        floatCompanyId: tenantId,
        lastWorkspaceId,
        lastWorkspaceManual,
        workspaces,
      })
      : { workspaceId: '', companyId: '', source: '' };
    workspaceId = resolved.workspaceId;
    tenantId = resolved.companyId;
  }
  return { workspaceId, tenantId };
}

/** 下发 job 的失败：配额与未配置智能体要给购买/设置入口，其余原样带错因。 */
function platformCreateFailure(e, baseUrl, tenantId) {
  if (e?.status === 422 || e?.errorCode === 'AGENT_RESOURCE_NOT_CONFIGURED') {
    return { ok: false, ...agentResourceNotConfiguredMessage(baseUrl, tenantId), traceId: e.traceId || '' };
  }
  if (e?.errorCode === 'SYS_AUTO_INNOVATE_QUOTA_EXCEEDED') {
    return { ok: false, ...sysAutoInnovateQuotaExceededMessage(baseUrl, tenantId), traceId: e.traceId || '' };
  }
  if (e?.status === 402 || e?.errorCode === 'AUTO_INNOVATE_QUOTA_EXCEEDED') {
    return { ok: false, ...autoInnovateQuotaExceededMessage(baseUrl, tenantId), traceId: e.traceId || '' };
  }
  return {
    ok: false,
    error: e?.message || tx('paCreateTaskFailed'),
    errorCode: e?.errorCode || '',
    traceId: e?.traceId || '',
  };
}
