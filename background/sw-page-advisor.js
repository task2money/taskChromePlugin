/** Alt+Z page-optimization-suggest: auth → page context → suggest job → poll → content UI. */

'use strict';

// 与 conf/ai/task-page-advisor upstreamTimeoutSec(60s) + 排队开销对齐。
// 现网成功 job 常见 17–27s；15s 客户端上限会在 LLM 仍成功时误报超时。
const PAGE_ADVISOR_POLL_MAX_MS = 75000;
const PAGE_ADVISOR_POLL_MAX_SEC = Math.round(PAGE_ADVISOR_POLL_MAX_MS / 1000);

/**
 * 可选截图上传钩子（失败不阻断）。默认跳过复杂路径；需要时由调用方注入。
 * @param {number} _tabId
 * @returns {Promise<string>} screenshot_url or ''
 */
async function capturePageAdvisorScreenshotHook(_tabId) {
  // Screenshot-Hook-OK: optional; design allows skip when complex — leave hook for later.
  return '';
}

/**
 * 向 tab 顶层 frame 取页面上下文；失败则整 tab 广播。
 * @param {number} tabId
 */
async function askContentPageAdvisorContext(tabId) {
  const msg = { action: 'getPageAdvisorContext' };
  const wrap = (p) => (typeof withTimeout === 'function' ? withTimeout(p, 12000, 'getPageAdvisorContext') : p);
  try {
    return await wrap(chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }));
  } catch (frame0Err) {
    console.warn('[taskChromePlugin] getPageAdvisorContext frame0 失败，回退整 tab 广播:', frame0Err?.message || frame0Err);
    return await wrap(chrome.tabs.sendMessage(tabId, msg));
  }
}

async function notifyContentPageAdvisor(tabId, payload) {
  const msg = { action: 'pageAdvisorResult', ...payload };
  try {
    await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch (_) {
    try {
      await chrome.tabs.sendMessage(tabId, msg);
    } catch (e) {
      console.warn('[taskChromePlugin] pageAdvisorResult 投递失败:', e?.message || e);
    }
  }
}

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

/**
 * Alt+Z 主流程（await 轮询以保持 MV3 SW 存活，上限 PAGE_ADVISOR_POLL_MAX_MS）。
 * @param {number} tabId
 */
async function loadPageAdvisorDirectReady() {
  let llmCfg = { apiKey: '', baseUrl: '', model: '' };
  if (typeof PageAdvisorLlmConfig !== 'undefined' && PageAdvisorLlmConfig.loadFromStorage) {
    try {
      llmCfg = await PageAdvisorLlmConfig.loadFromStorage();
    } catch (e) {
      console.warn('[taskChromePlugin] load page-advisor LLM config:', e?.message || e);
    }
  }
  const hasCfg = typeof PageAdvisorLlmConfig !== 'undefined';
  const route = (hasCfg && typeof PageAdvisorLlmConfig.resolveRoute === 'function')
    ? PageAdvisorLlmConfig.resolveRoute(llmCfg) : 'direct';
  const keyReady = hasCfg && PageAdvisorLlmConfig.isDirectLlmReady(llmCfg)
    && typeof PageAdvisorLLM !== 'undefined' && typeof PageAdvisorLLM.suggest === 'function';
  const directReady = route === 'direct' && keyReady;
  return { llmCfg, route, directReady };
}

function resolvePageAdvisorLocale() {
  try {
    if (typeof AidevpushI18n !== 'undefined' && typeof AidevpushI18n.getLocale === 'function') {
      const loc = String(AidevpushI18n.getLocale() || '').trim();
      if (loc) return loc;
    }
  } catch (_) { /* ignore */ }
  return 'zh-CN';
}

async function loadDirectLlmSkill(sessionOk) {
  if (typeof PageAdvisorPromptSkills === 'undefined'
    || typeof PageAdvisorPromptSkills.loadFromStorage !== 'function') {
    return null;
  }
  const store = await PageAdvisorPromptSkills.loadFromStorage();
  const existing = PageAdvisorPromptSkills.getActive(store);
  if (existing) return existing;
  if (!sessionOk) return null;
  if (typeof PageAdvisorAPI === 'undefined'
    || typeof PageAdvisorAPI.getSystemPromptSkills !== 'function') {
    return null;
  }
  const catalog = await PageAdvisorAPI.getSystemPromptSkills();
  const live = (catalog && catalog.skills) || [];
  const lastWs = (typeof Storage !== 'undefined' && typeof Storage.getLastWorkspace === 'function')
    ? String(await Storage.getLastWorkspace() || '').trim()
    : '';
  const rec = PageAdvisorPromptSkills.applySystemCatalogDefault(
    store,
    live.length ? catalog : { skills: [] },
    lastWs || PageAdvisorPromptSkills.SYNC_LOCAL,
    { overlayExisting: live.length > 0 },
  );
  if (rec.action !== 'applied') return null;
  await PageAdvisorPromptSkills.saveToStorage(rec.store);
  const active = PageAdvisorPromptSkills.getActive(rec.store);
  if (active) {
    console.info('[taskChromePlugin] direct LLM applying system catalog skill', active.title);
  }
  return active;
}

async function runPageOptimizationSuggest(tabId) {
  await Storage.migrateStaleTokenExpiryOnce();
  const cfg = await Storage.getApiConfig();
  const mapping = await Storage.getEndpointMapping();
  const cred = await Storage.getCredentials();
  const expired = cfg.token ? await Storage.isTokenExpired() : false;
  let { llmCfg, directReady, route } = await loadPageAdvisorDirectReady();
  const sessionOk = !!(cfg.token && !expired);
  const command = consumePageAdvisorSuggestCommand();
  const timingRun = beginPageAdvisorTimingRun(route, command);
  const withSpan = bindPageAdvisorWithSpan(timingRun);

  if (route === 'builtin' && globalThis.LanguageModel && PageAdvisorBuiltinPrompt?.runAltZ) {
    await PageAdvisorBuiltinPrompt.runAltZ(tabId, {
      languageModel: globalThis.LanguageModel,
      askContext: (id) => withSpan('capture', () => askContentPageAdvisorContext(id)),
      notify: wrapBuiltinAdvisorNotify(notifyContentPageAdvisor, withSpan, timingRun),
      loadSkill: () => withSpan('prompt', () => loadDirectLlmSkill(sessionOk)),
      locale: resolvePageAdvisorLocale(),
      tx,
      withSpan,
    });
    return;
  }
  if (route === 'direct' && !directReady) {
    finishPageAdvisorTiming(timingRun, false, '');
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: tx('paDirectNeedsConfig'),
    });
    return;
  }

  if (!directReady && !sessionOk) {
    finishPageAdvisorTiming(timingRun, false, '');
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: tx('paGuestNeedLlmOrLogin'),
    });
    return;
  }

  if (sessionOk) {
    API.init(cfg.baseUrl, cfg.token, mapping, cred.userId || '');
    if (mapping.owner) API.setOwner(mapping.owner);
  }

  await notifyContentPageAdvisor(tabId, { ok: true, phase: 'loading', message: tx('paCollecting') });

  let ctxResp;
  try {
    ctxResp = await withSpan('capture', () => askContentPageAdvisorContext(tabId));
  } catch (e) {
    finishPageAdvisorTiming(timingRun, false, '');
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: e?.message || tx('paContextReadFailed'),
    });
    return;
  }

  if (!ctxResp?.success || !ctxResp.data) {
    finishPageAdvisorTiming(timingRun, false, '');
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: ctxResp?.error || tx('paContextUnavailable'),
    });
    return;
  }

  const data = ctxResp.data;
  const locale = resolvePageAdvisorLocale();
  if (directReady) {
    await notifyContentPageAdvisor(tabId, {
      ok: true,
      phase: 'loading',
      message: tx('paDirectLlmGenerating'),
    });
    try {
      let skill = null;
      try {
        skill = await withSpan('prompt', () => loadDirectLlmSkill(sessionOk));
      } catch (skillErr) {
        console.warn('[taskChromePlugin] load prompt skills:', skillErr?.message || skillErr);
      }
      const suggestions = await PageAdvisorLLM.suggest(llmCfg, {
        url: data.url,
        title: data.title,
        pageText: data.pageText,
        domOutline: Array.isArray(data.domOutline) ? data.domOutline : [],
      }, {
        skill,
        locale,
        onSpan: (id, startAbs, endAbs, status) => {
          if (!timingRun || typeof PageAdvisorTiming === 'undefined') return;
          PageAdvisorTiming.addClosedSpan(timingRun, id, startAbs, endAbs, status);
          broadcastPageAdvisorWaterfall(timingRun);
        },
      });
      await notifyPageAdvisorDone(tabId, {
        ok: true,
        phase: 'done',
        jobId: '',
        pageUrl: String(data.url || ''),
        suggestions,
        featureParamsSource: 'plugin_direct',
      }, withSpan, timingRun);
    } catch (e) {
      const tid = (typeof APIHttp !== 'undefined' && APIHttp.newRequestTraceId)
        ? String(APIHttp.newRequestTraceId() || '').trim()
        : `page-advisor-direct-${Date.now()}`;
      finishPageAdvisorTiming(timingRun, false, tid);
      await notifyContentPageAdvisor(tabId, {
        ok: false,
        error: e?.message || tx('paGenerateFailed'),
        errorCode: 'PLUGIN_DIRECT_LLM_FAILED',
        traceId: tid,
      });
      // OPT-20260922-035: 把用户看到的 traceId best-effort 送到观测口，
      // 让 Loki 能按同一 ID 重建直连失败现场（未登录/无 tenant 由 lib 内部跳过）。
      if (typeof PageAdvisorAPI !== 'undefined'
        && typeof PageAdvisorAPI.reportDirectLlmFailure === 'function') {
        await PageAdvisorAPI.reportDirectLlmFailure({
          sessionOk,
          tenantId: data.companyId || data.tenantId,
          err: e,
          traceId: tid,
          model: llmCfg?.model,
          apiKey: llmCfg?.apiKey,
        });
      }
    }
    return;
  }

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
    const resolved = (typeof PageAdvisorDefaults !== 'undefined'
      && PageAdvisorDefaults.resolvePageAdvisorWorkspace)
      ? PageAdvisorDefaults.resolvePageAdvisorWorkspace({
        floatWorkspaceId: workspaceId,
        floatCompanyId: tenantId,
        lastWorkspaceId,
        workspaces,
      })
      : { workspaceId: '', companyId: '', source: '' };
    workspaceId = resolved.workspaceId;
    tenantId = resolved.companyId;
  }

  if (!workspaceId || !tenantId) {
    finishPageAdvisorTiming(timingRun, false, '');
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: tx('paSelectWorkspaceAltZ'),
    });
    return;
  }

  if ((route === 'saas' || route === 'system')
    && typeof overlayPageAdvisorTenantPref === 'function') {
    llmCfg = await overlayPageAdvisorTenantPref(llmCfg, tenantId);
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
    workspace_id: workspaceId,
    page_url: String(data.url || ''),
    page_title: String(data.title || ''),
    page_text: String(data.pageText || ''),
    screenshot_url: screenshotUrl || '',
    dom_outline: Array.isArray(data.domOutline) ? data.domOutline : [],
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
  let createTraceId = '';
  try {
    created = await withSpan('network', () => PageAdvisorAPI.createSuggestJob(tenantId, body, idempotencyKey));
    createTraceId = String(created?.trace_id || created?.traceId || created?._resolvedTraceId || '').trim();
  } catch (e) {
    finishPageAdvisorTiming(timingRun, false, e?.traceId || '');
    if (e?.status === 422 || e?.errorCode === 'AGENT_RESOURCE_NOT_CONFIGURED') {
      await notifyContentPageAdvisor(tabId, {
        ok: false,
        ...agentResourceNotConfiguredMessage(cfg.baseUrl, tenantId),
        traceId: e.traceId || '',
      });
      return;
    }
    if (e?.errorCode === 'SYS_AUTO_INNOVATE_QUOTA_EXCEEDED') {
      await notifyContentPageAdvisor(tabId, {
        ok: false,
        ...sysAutoInnovateQuotaExceededMessage(cfg.baseUrl, tenantId),
        traceId: e.traceId || '',
      });
      return;
    }
    if (e?.status === 402 || e?.errorCode === 'AUTO_INNOVATE_QUOTA_EXCEEDED') {
      await notifyContentPageAdvisor(tabId, {
        ok: false,
        ...autoInnovateQuotaExceededMessage(cfg.baseUrl, tenantId),
        traceId: e.traceId || '',
      });
      return;
    }
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: e?.message || tx('paCreateTaskFailed'),
      traceId: e?.traceId || '',
      errorCode: e?.errorCode || '',
    });
    return;
  }

  if (!createTraceId && typeof APIHttp !== 'undefined' && APIHttp.newRequestTraceId) {
    createTraceId = String(APIHttp.newRequestTraceId() || '').trim();
  }

  const jobId = String(created?.job_id || created?.id || '').trim();
  if (!jobId) {
    finishPageAdvisorTiming(timingRun, false, createTraceId);
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: tx('paNoJobId'),
      traceId: createTraceId,
    });
    return;
  }

  let job;
  try {
    job = await withSpan('saas_poll', () => PageAdvisorAPI.pollSuggestJob(tenantId, jobId, {
      maxMs: PAGE_ADVISOR_POLL_MAX_MS,
      seedTraceId: createTraceId,
    }));
  } catch (e) {
    const timedOut = /timeout|超时|timed?\s*out/i.test(String(e?.message || e?.errorCode || ''));
    const timeoutTraceId = String(e?.traceId || createTraceId || '').trim()
      || (typeof APIHttp !== 'undefined' && APIHttp.newRequestTraceId
        ? String(APIHttp.newRequestTraceId() || '').trim()
        : '')
      || `page-advisor-timeout-${Date.now()}`;
    finishPageAdvisorTiming(timingRun, false, timeoutTraceId);
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: timedOut
        ? tx('paPollTimeout', { sec: PAGE_ADVISOR_POLL_MAX_SEC })
        : (e?.message || tx('paPollFailed')),
      errorCode: timedOut ? 'PAGE_ADVISOR_TIMEOUT' : (e?.errorCode || ''),
      // 请求失败 UI 必须带 data-traceId（约束 24）；超时路径禁止空串。
      traceId: timeoutTraceId,
    });
    return;
  }

  const status = String(job?.status || '').toLowerCase();
  if (status === 'failed' || status === 'expired') {
    // LLM 402 Insufficient Balance 等失败也须带 data-traceId（约束 24）。
    const failTraceId = PageAdvisorFailTraceId.resolvePageAdvisorFailTraceId(job, createTraceId);
    finishPageAdvisorTiming(timingRun, false, failTraceId);
    if (job?.error_code === 'AGENT_RESOURCE_NOT_CONFIGURED') {
      await notifyContentPageAdvisor(tabId, {
        ok: false,
        ...agentResourceNotConfiguredMessage(cfg.baseUrl, tenantId),
        traceId: failTraceId,
      });
      return;
    }
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: job?.error_message || tx('paGenerateFailed'),
      errorCode: job?.error_code || '',
      traceId: failTraceId,
    });
    return;
  }

  let suggestions = job?.suggestions;
  await withSpan('parse', async () => {
    if (typeof suggestions === 'string') {
      try { suggestions = JSON.parse(suggestions); } catch (_) { suggestions = []; }
    }
    if (!Array.isArray(suggestions)) {
      suggestions = Array.isArray(job?.suggestions_json) ? job.suggestions_json : [];
    }
  });

  await notifyPageAdvisorDone(tabId, {
    ok: true,
    phase: 'done',
    jobId,
    pageUrl: body.page_url,
    suggestions,
    featureParamsSource: job?.feature_params_source || '',
    traceId: createTraceId,
  }, withSpan, timingRun);
}
