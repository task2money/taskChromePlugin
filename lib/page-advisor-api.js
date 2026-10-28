/**
 * taskPageAdvisor API 客户端 — suggest-jobs / agent-resource-status。
 * 路径均含 tenant_id；写操作带 Idempotency-Key。
 */

'use strict';

const PageAdvisorAPI = (() => {
  const APIHttp = (typeof module !== 'undefined' && module.exports)
    ? require('./api-http.js')
    : (typeof globalThis !== 'undefined' && globalThis.APIHttp) || {};

  const ENDPOINTS = {
    suggestJobs: '/api/page-advisor/tenant_id/{tenantId}/suggest-jobs/', // Api-Version-Legacy-OK: pre-v1 tenant path
    suggestJob: '/api/page-advisor/tenant_id/{tenantId}/suggest-jobs/{jobId}/', // Api-Version-Legacy-OK: pre-v1 tenant path
    agentResourceStatus:
      '/api/page-advisor/tenant_id/{tenantId}/agent-resource-status/?workspace_id={workspaceId}', // Api-Version-Legacy-OK: pre-v1 tenant path
    pendingSuggestions:
      '/api/page-advisor/tenant_id/{tenantId}/pending-suggestions/?page_url={pageUrl}', // Api-Version-Legacy-OK: pre-v1 tenant path
    // ADR-0167：侧边栏生成建议落成优化贴（同一入口的 POST）。
    pendingSuggestionsCreate:
      '/api/page-advisor/tenant_id/{tenantId}/pending-suggestions/', // Api-Version-Legacy-OK: pre-v1 tenant path
    confirmSuggestion:
      '/api/page-advisor/tenant_id/{tenantId}/suggestions/{suggestionId}/confirm/', // Api-Version-Legacy-OK: pre-v1 tenant path
    dismissSuggestion:
      '/api/page-advisor/tenant_id/{tenantId}/suggestions/{suggestionId}/dismiss/', // Api-Version-Legacy-OK: pre-v1 tenant path
    // v233：登录用户把匿名优化贴领取到自己的项目（凭只读令牌）。
    pageTrialPostClaim:
      '/api/page-advisor/v1/tenant_id/{tenantId}/page-trial-posts/{postId}/claim/',
    systemPromptSkills: '/api/page-advisor/v1/system-prompt-skills/',
    promptSkills: '/api/page-advisor/v1/tenant_id/{tenantId}/workspace_id/{workspaceId}/prompt-skills/',
    tenantAgentPref: '/api/page-advisor/v1/tenant_id/{tenantId}/agent-pref/',
  };

  /**
   * 成功响应挂解析后的 traceId（enumerable trace_id + 非枚举 _resolvedTraceId）。
   * 网关/上游若漏回写 body.trace_id，客户端仍可用创建时的 X-Trace-Id 排障。
   * @param {object|null} payload
   * @param {Response} res
   * @param {string} requestTraceId
   */
  function stampResolvedTraceId(payload, res, requestTraceId) {
    if (!payload || typeof payload !== 'object') return payload;
    const headerOrClient = APIHttp.resolveTraceId(res, requestTraceId, '')
      || String(requestTraceId || '').trim();
    const bodyTid = String(payload.trace_id || payload.traceId || '').trim();
    if (!bodyTid && headerOrClient) {
      payload.trace_id = headerOrClient;
    }
    // Prefer job/create body trace_id over this request's X-Trace-Id so poll stamps
    // stay joinable with page_advisor_llm_failed (job.TraceID).
    const tid = bodyTid || headerOrClient;
    if (!tid) return payload;
    Object.defineProperty(payload, '_resolvedTraceId', {
      value: tid,
      enumerable: false,
      configurable: true,
    });
    return payload;
  }

  function requireSession(session) {
    const baseUrl = String(session?.baseUrl || '').replace(/\/+$/, '');
    const token = String(session?.token || '').trim();
    if (!baseUrl || !token) {
      const err = new Error(tx('paApiNotInitialized'));
      err.errorCode = 'PA_SESSION_MISSING';
      throw err;
    }
    return { baseUrl, token };
  }

  /**
   * 带可选额外头的请求（Idempotency-Key）。
   * @param {{ baseUrl: string, token: string }} session
   * @param {string} method
   * @param {string} path
   * @param {object|null} [body]
   * @param {Record<string, string>|null} [extraHeaders]
   */
  async function requestWithHeaders(session, method, path, body = null, extraHeaders = null) {
    session = requireSession(session);
    const url = `${session.baseUrl}${path}`;
    const requestTraceId = APIHttp.newRequestTraceId();
    const headers = {
      'Content-Type': 'application/json',
      'X-Trace-Id': requestTraceId,
      ...(extraHeaders || {}),
    };
    const authHeader = APIHttp.buildAuthorizationHeader(session.token);
    if (authHeader) headers.Authorization = authHeader;

    const opts = { method, headers };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }

    const res = await APIHttp.fetchWithClientTrace(url, opts, requestTraceId);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch (_) { /* ignore */ }
      const err = new Error(APIHttp.formatHttpError(method, path, res.status, text));
      err.status = res.status;
      err.traceId = APIHttp.resolveTraceId(res, requestTraceId, text);
      err.errorCode = parsed?.error_code || parsed?.errorCode || '';
      err.detail = parsed?.detail || parsed?.message || '';
      err.body = parsed;
      throw err;
    }
    if (res.status === 204) return null;
    const ct = res.headers?.get?.('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      return stampResolvedTraceId(data, res, requestTraceId);
    }
    const data = await res.json().catch(() => null);
    return stampResolvedTraceId(data, res, requestTraceId);
  }

  function sessionFromApi() {
    const api = typeof API !== 'undefined' ? API : null;
    if (!api) {
      const err = new Error(tx('paApiNotInitialized'));
      err.errorCode = 'PA_SESSION_MISSING';
      throw err;
    }
    return requireSession({ baseUrl: api.getBaseUrl(), token: api.getToken() });
  }

  /**
   * POST 创建建议 job。
   * @param {string} tenantId
   * @param {{ workspace_id: string, page_url: string, page_title?: string, page_text?: string, screenshot_url?: string }} body
   * @param {string} idempotencyKey
   * @param {{ baseUrl?: string, token?: string }} [sessionOverride]
   */
  async function createSuggestJob(tenantId, body, idempotencyKey, sessionOverride) {
    const session = sessionOverride || sessionFromApi();
    const path = APIHttp.buildPath(ENDPOINTS.suggestJobs, { tenantId });
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new Error(tx('swMissingIdempotencyKey'));
    return requestWithHeaders(session, 'POST', path, body, {
      'Idempotency-Key': key,
    });
  }

  /**
   * GET job 状态与结果。
   */
  async function getSuggestJob(tenantId, jobId, sessionOverride) {
    const session = sessionOverride || sessionFromApi();
    const path = APIHttp.buildPath(ENDPOINTS.suggestJob, { tenantId, jobId });
    return requestWithHeaders(session, 'GET', path);
  }

  /**
   * GET 智能体资源预检。
   */
  async function getAgentResourceStatus(tenantId, workspaceId, sessionOverride) {
    const session = sessionOverride || sessionFromApi();
    const path = APIHttp.buildPath(ENDPOINTS.agentResourceStatus, {
      tenantId,
      workspaceId: workspaceId || '',
    });
    return requestWithHeaders(session, 'GET', path);
  }

  /** GET pending site suggestions for current page URL (ADR-0084). */
  async function listPendingSuggestions(tenantId, pageUrl, sessionOverride) {
    const session = sessionOverride || sessionFromApi();
    const path = APIHttp.buildPath(ENDPOINTS.pendingSuggestions, {
      tenantId,
      pageUrl: String(pageUrl || ''),
    });
    return requestWithHeaders(session, 'GET', path);
  }

  /**
   * POST 把一次生成结果落成当前网页的优化贴（ADR-0167）。
   * 命中域名绑定的项目就挂那个项目，没有就挂默认项目，落点由服务端回报。
   * @param {string} tenantId
   * @param {{ page_url: string, title?: string, summary?: string, detail?: string,
   *   prompt_tendency?: string, suggestions?: object[] }} body
   * @param {string} idempotencyKey
   * @param {{ baseUrl?: string, token?: string }} [sessionOverride]
   */
  async function createPendingSuggestion(tenantId, body, idempotencyKey, sessionOverride) {
    const session = sessionOverride || sessionFromApi();
    const path = APIHttp.buildPath(ENDPOINTS.pendingSuggestionsCreate, { tenantId });
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new Error(tx('swMissingIdempotencyKey'));
    return requestWithHeaders(session, 'POST', path, body, {
      'Idempotency-Key': key,
      // 落贴请求的 traceId 与生成同源，服务端日志能顺着同一条串起来。
      'X-Trace-Id': `page-advisor-agent-${key}`,
    });
  }

  /**
   * POST 领取一条匿名优化贴：服务端把帖复制到当前用户的落点项目，原帖随即关闭。
   * 必须带只读令牌；同一用户重试返回 already_claimed，不产生第二条帖。
   * @param {string} tenantId
   * @param {string} postId
   * @param {string} viewToken
   * @param {string} idempotencyKey
   * @param {{ baseUrl?: string, token?: string }} [sessionOverride]
   */
  async function claimPageTrialPost(tenantId, postId, viewToken, idempotencyKey, sessionOverride) {
    const session = sessionOverride || sessionFromApi();
    const tid = String(tenantId || '').trim();
    const pid = String(postId || '').trim();
    if (!tid || !pid) throw new Error(tx('swMissingPostOrToken'));
    const path = APIHttp.buildPath(ENDPOINTS.pageTrialPostClaim, { tenantId: tid, postId: pid });
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new Error(tx('swMissingIdempotencyKey'));
    const token = String(viewToken || '').trim();
    if (!token) {
      const err = new Error(tx('paTrialPostTokenRequired'));
      err.errorCode = 'PAGE_TRIAL_POST_TOKEN_MISSING';
      throw err;
    }
    return requestWithHeaders(session, 'POST', path, {}, {
      'Idempotency-Key': key,
      'X-View-Token': token,
    });
  }

  async function confirmSuggestion(tenantId, suggestionId, idempotencyKey, sessionOverride) {
    const session = sessionOverride || sessionFromApi();
    const path = APIHttp.buildPath(ENDPOINTS.confirmSuggestion, { tenantId, suggestionId });
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new Error(tx('swMissingIdempotencyKey'));
    return requestWithHeaders(session, 'POST', path, {}, { 'Idempotency-Key': key });
  }

  async function dismissSuggestion(tenantId, suggestionId, idempotencyKey, sessionOverride) {
    const session = sessionOverride || sessionFromApi();
    const path = APIHttp.buildPath(ENDPOINTS.dismissSuggestion, { tenantId, suggestionId });
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new Error(tx('swMissingIdempotencyKey'));
    return requestWithHeaders(session, 'POST', path, {}, { 'Idempotency-Key': key });
  }

  function pickJobTraceId(job, fallback) {
    const fromBody = String(job?.trace_id || job?.traceId || '').trim();
    if (fromBody) return fromBody;
    const prior = String(fallback || '').trim();
    if (prior) return prior;
    return String(job?._resolvedTraceId || '').trim();
  }

  /**
   * 轮询 job 至终态或超时。
   * @param {string} tenantId
   * @param {string} jobId
   * @param {{ maxMs?: number, initialDelayMs?: number, maxDelayMs?: number, sleep?: (ms:number)=>Promise<void>, session?: object, seedTraceId?: string }} [opts]
   */
  async function pollSuggestJob(tenantId, jobId, opts = {}) {
    const maxMs = opts.maxMs ?? 60000;
    const maxDelayMs = opts.maxDelayMs ?? 4000;
    let delay = opts.initialDelayMs ?? 500;
    const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const started = Date.now();
    let last = null;
    let lastTraceId = String(opts.seedTraceId || '').trim();

    while (Date.now() - started < maxMs) {
      last = await getSuggestJob(tenantId, jobId, opts.session);
      lastTraceId = pickJobTraceId(last, lastTraceId);
      const status = String(last?.status || '').toLowerCase();
      if (status === 'succeeded' || status === 'failed' || status === 'expired') {
        return last;
      }
      await sleep(delay);
      delay = Math.min(maxDelayMs, Math.round(delay * 1.5));
    }
    const err = new Error(tx('paTimeoutRetry'));
    err.errorCode = 'SUGGEST_JOB_TIMEOUT';
    err.lastJob = last;
    // 超时仍须可排障：job/seed/本轮 GET 的 _resolvedTraceId，再兜底新 mint（禁止空 traceId）。
    err.traceId = lastTraceId
      || String(last?._resolvedTraceId || '').trim()
      || (typeof APIHttp.newRequestTraceId === 'function' ? APIHttp.newRequestTraceId() : '')
      || `page-advisor-timeout-${Date.now()}`;
    throw err;
  }

  async function getSystemPromptSkills(sessionOverride) {
    const session = sessionOverride || sessionFromApi();
    return requestWithHeaders(session, 'GET', ENDPOINTS.systemPromptSkills, null, null);
  }

  async function getPromptSkills(tenantId, workspaceId, sessionOverride) {
    const session = sessionOverride || sessionFromApi();
    const tid = String(tenantId || '').trim();
    const wid = String(workspaceId || '').trim();
    if (!tid || !wid) throw new Error(tx('paSkillNeedWorkspace'));
    const path = APIHttp.buildPath(ENDPOINTS.promptSkills, { tenantId: tid, workspaceId: wid });
    return requestWithHeaders(session, 'GET', path, null, null);
  }

  /** GET 租户默认自动创新来源（系统 SKU / 自有）。 */
  async function getTenantAgentPref(tenantId, sessionOverride) {
    const session = sessionOverride || sessionFromApi();
    const tid = String(tenantId || '').trim();
    if (!tid) {
      const err = new Error(tx('paSelectWorkspaceAltZ'));
      err.errorCode = 'PA_TENANT_MISSING';
      throw err;
    }
    const path = APIHttp.buildPath(ENDPOINTS.tenantAgentPref, { tenantId: tid });
    return requestWithHeaders(session, 'GET', path);
  }

  return {
    ENDPOINTS,
    createSuggestJob,
    getSuggestJob,
    getAgentResourceStatus,
    listPendingSuggestions,
    createPendingSuggestion,
    claimPageTrialPost,
    confirmSuggestion,
    dismissSuggestion,
    pollSuggestJob,
    getSystemPromptSkills,
    getPromptSkills,
    getTenantAgentPref,
    requestWithHeaders,
    pickJobTraceId,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorAPI;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorAPI = PageAdvisorAPI;
}
