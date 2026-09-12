/** Alt+E page-optimization-suggest: auth → page context → suggest job → poll → content UI. */

'use strict';

const PAGE_ADVISOR_POLL_MAX_MS = 60000;

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
    console.warn(
      '[taskChromePlugin] getPageAdvisorContext frame0 失败，回退整 tab 广播:',
      frame0Err?.message || frame0Err,
    );
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
    message:
      '当前租户与个人均未配置可用智能体资源，请先配置后再试。',
    links: [
      { label: '租户设置 → 智能体/环境参数', href: tenantPath },
      { label: '个人中心 → 个人智能体配置', href: personalPath },
    ],
  };
}

/**
 * Alt+E 主流程（await 轮询以保持 MV3 SW 存活，上限 PAGE_ADVISOR_POLL_MAX_MS）。
 * @param {number} tabId
 */
async function runPageOptimizationSuggest(tabId) {
  await Storage.migrateStaleTokenExpiryOnce();
  const cfg = await Storage.getApiConfig();
  const mapping = await Storage.getEndpointMapping();
  const cred = await Storage.getCredentials();
  const expired = cfg.token ? await Storage.isTokenExpired() : false;

  if (!cfg.token || expired) {
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: '请先在扩展弹窗中登录后再使用 Alt+E 页面优化建议',
    });
    return;
  }

  API.init(cfg.baseUrl, cfg.token, mapping, cred.userId || '');
  if (mapping.owner) API.setOwner(mapping.owner);

  await notifyContentPageAdvisor(tabId, { ok: true, phase: 'loading', message: '正在采集页面并生成优化建议…' });

  let ctxResp;
  try {
    ctxResp = await askContentPageAdvisorContext(tabId);
  } catch (e) {
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: e?.message || '无法读取页面上下文（请刷新页面后重试）',
    });
    return;
  }

  if (!ctxResp?.success || !ctxResp.data) {
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: ctxResp?.error || '无法读取页面上下文',
    });
    return;
  }

  const data = ctxResp.data;
  const workspaceId = String(data.workspaceId || '').trim();
  const tenantId = String(data.companyId || data.tenantId || '').trim();

  if (!workspaceId || !tenantId) {
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: '请先打开浮窗并选择工作空间（需含租户）后再按 Alt+E',
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
  };

  let created;
  try {
    created = await PageAdvisorAPI.createSuggestJob(tenantId, body, idempotencyKey);
  } catch (e) {
    if (e?.status === 422 || e?.errorCode === 'AGENT_RESOURCE_NOT_CONFIGURED') {
      await notifyContentPageAdvisor(tabId, {
        ok: false,
        ...agentResourceNotConfiguredMessage(cfg.baseUrl, tenantId),
        traceId: e.traceId || '',
      });
      return;
    }
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: e?.message || '创建建议任务失败',
      traceId: e?.traceId || '',
      errorCode: e?.errorCode || '',
    });
    return;
  }

  const jobId = String(created?.job_id || created?.id || '').trim();
  if (!jobId) {
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: '建议任务未返回 job_id',
    });
    return;
  }

  let job;
  try {
    job = await PageAdvisorAPI.pollSuggestJob(tenantId, jobId, {
      maxMs: PAGE_ADVISOR_POLL_MAX_MS,
    });
  } catch (e) {
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: e?.message || '轮询建议结果失败',
      errorCode: e?.errorCode || '',
      traceId: e?.traceId || '',
    });
    return;
  }

  const status = String(job?.status || '').toLowerCase();
  if (status === 'failed' || status === 'expired') {
    if (job?.error_code === 'AGENT_RESOURCE_NOT_CONFIGURED') {
      await notifyContentPageAdvisor(tabId, {
        ok: false,
        ...agentResourceNotConfiguredMessage(cfg.baseUrl, tenantId),
        traceId: job?.trace_id || '',
      });
      return;
    }
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: job?.error_message || '生成优化建议失败',
      errorCode: job?.error_code || '',
      traceId: job?.trace_id || '',
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
