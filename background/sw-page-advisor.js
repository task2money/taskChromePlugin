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
  let resp;
  try {
    resp = await chrome.tabs.sendMessage(
      tabId,
      { action: 'getPageAdvisorContext' },
      { frameId: 0 },
    );
  } catch (frame0Err) {
    // 单行：i18n 门禁按行扫描，多行 console 调用的续行会被误判为界面文案。
    console.warn('[taskChromePlugin] getPageAdvisorContext frame0 失败，回退整 tab 广播:', frame0Err?.message || frame0Err);
    resp = await chrome.tabs.sendMessage(tabId, { action: 'getPageAdvisorContext' });
  }
  return resp;
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
  const directReady = typeof PageAdvisorLlmConfig !== 'undefined'
    && PageAdvisorLlmConfig.isDirectLlmReady(llmCfg)
    && typeof PageAdvisorLLM !== 'undefined'
    && typeof PageAdvisorLLM.suggest === 'function';
  return { llmCfg, directReady };
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

async function runPageOptimizationSuggest(tabId) {
  await Storage.migrateStaleTokenExpiryOnce();
  const cfg = await Storage.getApiConfig();
  const mapping = await Storage.getEndpointMapping();
  const cred = await Storage.getCredentials();
  const expired = cfg.token ? await Storage.isTokenExpired() : false;
  const { llmCfg, directReady } = await loadPageAdvisorDirectReady();
  const sessionOk = !!(cfg.token && !expired);

  if (!directReady && !sessionOk) {
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
    ctxResp = await askContentPageAdvisorContext(tabId);
  } catch (e) {
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: e?.message || tx('paContextReadFailed'),
    });
    return;
  }

  if (!ctxResp?.success || !ctxResp.data) {
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
      if (typeof PageAdvisorPromptSkills !== 'undefined'
        && PageAdvisorPromptSkills.loadFromStorage) {
        try {
          const skillStore = await PageAdvisorPromptSkills.loadFromStorage();
          skill = PageAdvisorPromptSkills.getActive(skillStore);
          if (skill) {
            console.info('[taskChromePlugin] direct LLM applying prompt skill', skill.title);
          }
        } catch (skillErr) {
          console.warn('[taskChromePlugin] load prompt skills:', skillErr?.message || skillErr);
        }
      }
      const suggestions = await PageAdvisorLLM.suggest(llmCfg, {
        url: data.url,
        title: data.title,
        pageText: data.pageText,
        domOutline: Array.isArray(data.domOutline) ? data.domOutline : [],
      }, { skill, locale });
      await notifyContentPageAdvisor(tabId, {
        ok: true,
        phase: 'done',
        jobId: '',
        pageUrl: String(data.url || ''),
        suggestions,
        featureParamsSource: 'plugin_direct',
      });
    } catch (e) {
      const tid = (typeof APIHttp !== 'undefined' && APIHttp.newRequestTraceId)
        ? String(APIHttp.newRequestTraceId() || '').trim()
        : `page-advisor-direct-${Date.now()}`;
      await notifyContentPageAdvisor(tabId, {
        ok: false,
        error: e?.message || tx('paGenerateFailed'),
        errorCode: 'PLUGIN_DIRECT_LLM_FAILED',
        traceId: tid,
      });
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
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: tx('paSelectWorkspaceAltZ'),
    });
    return;
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

  const body = {
    workspace_id: workspaceId,
    page_url: String(data.url || ''),
    page_title: String(data.title || ''),
    page_text: String(data.pageText || ''),
    screenshot_url: screenshotUrl || '',
    dom_outline: Array.isArray(data.domOutline) ? data.domOutline : [],
    locale,
  };

  let created;
  let createTraceId = '';
  try {
    created = await PageAdvisorAPI.createSuggestJob(tenantId, body, idempotencyKey);
    createTraceId = String(created?.trace_id || created?.traceId || created?._resolvedTraceId || '').trim();
  } catch (e) {
    if (e?.status === 422 || e?.errorCode === 'AGENT_RESOURCE_NOT_CONFIGURED') {
      await notifyContentPageAdvisor(tabId, {
        ok: false,
        ...agentResourceNotConfiguredMessage(cfg.baseUrl, tenantId),
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
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: tx('paNoJobId'),
      traceId: createTraceId,
    });
    return;
  }

  let job;
  try {
    job = await PageAdvisorAPI.pollSuggestJob(tenantId, jobId, {
      maxMs: PAGE_ADVISOR_POLL_MAX_MS,
      seedTraceId: createTraceId,
    });
  } catch (e) {
    const timedOut = /timeout|超时|timed?\s*out/i.test(String(e?.message || e?.errorCode || ''));
    const timeoutTraceId = String(e?.traceId || createTraceId || '').trim()
      || (typeof APIHttp !== 'undefined' && APIHttp.newRequestTraceId
        ? String(APIHttp.newRequestTraceId() || '').trim()
        : '')
      || `page-advisor-timeout-${Date.now()}`;
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
  if (typeof suggestions === 'string') {
    try { suggestions = JSON.parse(suggestions); } catch (_) { suggestions = []; }
  }
  if (!Array.isArray(suggestions)) {
    suggestions = Array.isArray(job?.suggestions_json) ? job.suggestions_json : [];
  }

  await notifyContentPageAdvisor(tabId, {
    ok: true,
    phase: 'done',
    jobId,
    pageUrl: body.page_url,
    suggestions,
    featureParamsSource: job?.feature_params_source || '',
  });
}

/**
 * chrome.commands 入口。
 * @param {string} command
 */
async function handlePageOptimizationSuggestCommand() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) return;
  await runPageOptimizationSuggest(tabId);
}

/**
 * Alt+Shift+Z：先让 content 进入元素点选，确认后由 content 再发 pageOptimizationSuggest。
 */
async function handlePageOptimizationSuggestRegionCommand() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'startPageAdvisorRegionSelect' }, { frameId: 0 });
  } catch (frame0Err) {
    console.warn('[taskChromePlugin] startPageAdvisorRegionSelect frame0 失败，回退整 tab:', frame0Err?.message || frame0Err);
    await chrome.tabs.sendMessage(tabId, { action: 'startPageAdvisorRegionSelect' });
  }
}

/**
 * 迁移页面优化建议 chrome.commands：
 * - 清除遗留 Alt+E / Alt+Shift+E / Alt+`（及 Backquote）绑定
 * - 若当前无绑定，写入默认 Alt+Z / Alt+Shift+Z（升级自无 suggested_key 的版本）
 * 保留用户已改绑的其它组合。
 */
async function clearLegacyPageAdvisorChromeShortcuts() {
  if (
    typeof chrome.commands?.getAll !== 'function'
    || typeof chrome.commands?.update !== 'function'
  ) {
    return;
  }
  const legacy = new Set([
    'Alt+E',
    'Alt+Shift+E',
    'Alt+`',
    'Alt+Shift+`',
    'Alt+Backquote',
    'Alt+Shift+Backquote',
  ]);
  const defaults = {
    'page-optimization-suggest': 'Alt+Z',
    'page-optimization-suggest-region': 'Alt+Shift+Z',
  };
  try {
    const commands = await chrome.commands.getAll();
    for (const [name, desired] of Object.entries(defaults)) {
      const found = (commands || []).find((c) => c && c.name === name);
      const sc = String(found?.shortcut || '');
      if (legacy.has(sc)) {
        await chrome.commands.update({ name, shortcut: desired });
        continue;
      }
      if (!sc) {
        await chrome.commands.update({ name, shortcut: desired });
      }
    }
  } catch (e) {
    console.warn(
      '[taskChromePlugin] migrate page-advisor shortcuts:',
      e?.message || e,
    );
  }
}
