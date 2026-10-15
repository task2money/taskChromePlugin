/**
 * 生成建议的核心：为某个标签页跑完「取页面 → 选路由 → 出建议」。
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
 * 三条路由之外的第四条：本机内置模型（Chrome 自带）只在页面上生成，
 * 需要下载/启用引导，侧边栏这条出口不接管它。
 */
function builtinRouteRefusal() {
  return {
    ok: false,
    error: tx('agentSuggestionsGenerateBuiltin'),
    errorCode: 'AGENT_SUGGESTIONS_BUILTIN_ROUTE',
    traceId: '',
  };
}

/**
 * @param {number} tabId
 * @param {{
 *   onPhase?: (message: string) => void|Promise<void>,
 *   withSpan?: (id: string, fn: () => Promise<any>) => Promise<any>,
 *   onLlmSpan?: (id: string, startAbs: number, endAbs: number, status: string) => void,
 *   skill?: object|null,
 *   skillLoader?: () => Promise<object|null>,
 *   attachAnchors?: boolean,
 * }} [opts]
 * @returns {Promise<{ ok: true, pageUrl: string, pageTitle: string, suggestions: any[],
 *   jobId: string, featureParamsSource: string, traceId: string,
 *   tenantId?: string, workspaceId?: string }
 *   | { ok: false, error: string, errorCode: string, traceId: string, links?: any[] }>}
 */
async function generatePageAdvisorSuggestions(tabId, opts = {}) {
  const withSpan = typeof opts.withSpan === 'function' ? opts.withSpan : passthroughSpan;
  const onPhase = typeof opts.onPhase === 'function' ? opts.onPhase : () => {};

  const cfg = await Storage.getApiConfig();
  const mapping = await Storage.getEndpointMapping();
  const cred = await Storage.getCredentials();
  const expired = cfg.token ? await Storage.isTokenExpired() : false;
  const sessionOk = !!(cfg.token && !expired);
  let { llmCfg, directReady, route } = await loadPageAdvisorDirectReady();

  if (route === 'builtin') return builtinRouteRefusal();
  if (route === 'direct' && !directReady) {
    return { ok: false, error: tx('paDirectNeedsConfig'), errorCode: '', traceId: '' };
  }
  if (!directReady && !sessionOk) {
    return { ok: false, error: tx('paGuestNeedLlmOrLogin'), errorCode: '', traceId: '' };
  }
  if (sessionOk) {
    API.init(cfg.baseUrl, cfg.token, mapping, cred.userId || '');
    if (mapping.owner) API.setOwner(mapping.owner);
  }

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
  const skill = await loadSkillSafe(opts);

  if (directReady) {
    return generateViaDirectLlm({ llmCfg, page, locale, skill, sessionOk, tenantId: data.companyId || data.tenantId, opts, withSpan, onPhase });
  }
  return generateViaPlatform({ tabId, route, cfg, data, page, locale, llmCfg, opts, withSpan, onPhase });
}

/** 提示词是可选增强：取不到就按无提示词生成，别让整次生成失败。 */
async function loadSkillSafe(opts) {
  if (typeof opts.skillLoader !== 'function') return opts.skill || null;
  try {
    return await opts.skillLoader();
  } catch (e) {
    console.warn('[taskChromePlugin] load prompt skills:', e?.message || e);
    return null;
  }
}

async function generateViaDirectLlm({ llmCfg, page, locale, skill, sessionOk, tenantId, opts, withSpan, onPhase }) {
  await onPhase(tx('paDirectLlmGenerating'));
  let suggestions;
  try {
    suggestions = await withSpan('network', () => PageAdvisorLLM.suggest(llmCfg, {
      url: page.url,
      title: page.title,
      pageText: page.pageText,
      domOutline: page.domOutline,
    }, {
      skill,
      locale,
      onSpan: typeof opts.onLlmSpan === 'function' ? opts.onLlmSpan : undefined,
    }));
  } catch (e) {
    // OPT-20260922-035: 把用户看到的 traceId best-effort 送到观测口，
    // 让 Loki 能按同一 ID 重建直连失败现场（未登录/无 tenant 由 lib 内部跳过）。
    const traceId = (typeof APIHttp !== 'undefined' && APIHttp.newRequestTraceId)
      ? String(APIHttp.newRequestTraceId() || '').trim()
      : `page-advisor-direct-${Date.now()}`;
    if (typeof PageAdvisorAPI !== 'undefined'
      && typeof PageAdvisorAPI.reportDirectLlmFailure === 'function') {
      await PageAdvisorAPI.reportDirectLlmFailure({
        sessionOk: !!sessionOk,
        tenantId,
        err: e,
        traceId,
        model: llmCfg?.model,
        apiKey: llmCfg?.apiKey,
      });
    }
    return {
      ok: false,
      error: e?.message || tx('paGenerateFailed'),
      errorCode: 'PLUGIN_DIRECT_LLM_FAILED',
      traceId,
    };
  }
  return {
    ok: true,
    route: 'direct',
    pageUrl: page.url,
    pageTitle: page.title,
    tenantId: String(tenantId || '').trim(),
    suggestions: opts.attachAnchors && typeof attachSuggestionAnchors === 'function'
      ? attachSuggestionAnchors(suggestions, page.domOutline)
      : suggestions,
    jobId: '',
    featureParamsSource: 'plugin_direct',
    traceId: '',
  };
}

async function generateViaPlatform({ tabId, route, cfg, data, page, locale, llmCfg, opts, withSpan, onPhase }) {
  const scope = await resolvePlatformScope(data);
  if (!scope.workspaceId || !scope.tenantId) {
    return { ok: false, error: tx('paSelectWorkspaceAltZ'), errorCode: '', traceId: '' };
  }
  if ((route === 'saas' || route === 'system')
    && typeof overlayPageAdvisorTenantPref === 'function') {
    llmCfg = await overlayPageAdvisorTenantPref(llmCfg, scope.tenantId);
    route = (typeof PageAdvisorLlmConfig !== 'undefined'
      && typeof PageAdvisorLlmConfig.resolveRoute === 'function')
      ? PageAdvisorLlmConfig.resolveRoute(llmCfg)
      : route;
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
  }));
  if (route === 'system') {
    body.agent_source = 'system';
    body.sku_id = String(llmCfg.systemSkuId || '').trim();
  } else if (route === 'saas') {
    const ownModel = String(llmCfg.ownModel || '').trim();
    const ownProvider = String(llmCfg.ownProvider || '').trim();
    if (ownModel) body.own_model = ownModel;
    if (ownProvider) body.own_provider = ownProvider;
  }

  let created;
  try {
    created = await withSpan('network', () => PageAdvisorAPI.createSuggestJob(scope.tenantId, body, idempotencyKey));
  } catch (e) {
    return platformCreateFailure(e, cfg.baseUrl, scope.tenantId);
  }
  let createTraceId = String(created?.trace_id || created?.traceId || created?._resolvedTraceId || '').trim();
  if (!createTraceId) createTraceId = pageAdvisorFailTraceId('');

  const jobId = String(created?.job_id || created?.id || '').trim();
  if (!jobId) {
    return { ok: false, error: tx('paNoJobId'), errorCode: '', traceId: createTraceId };
  }

  let job;
  try {
    job = await withSpan('saas_poll', () => PageAdvisorAPI.pollSuggestJob(scope.tenantId, jobId, {
      maxMs: PAGE_ADVISOR_POLL_MAX_MS,
      seedTraceId: createTraceId,
    }));
  } catch (e) {
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
    route,
    pageUrl: body.page_url,
    pageTitle: page.title,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    suggestions,
    jobId,
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
