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
    suggestJobs: '/api/page-advisor/tenant_id/{tenantId}/suggest-jobs/',
    suggestJob: '/api/page-advisor/tenant_id/{tenantId}/suggest-jobs/{jobId}/',
    agentResourceStatus:
      '/api/page-advisor/tenant_id/{tenantId}/agent-resource-status/?workspace_id={workspaceId}',
  };

  /**
   * 带可选额外头的请求（Idempotency-Key）。
   * @param {{ baseUrl: string, token: string }} session
   * @param {string} method
   * @param {string} path
   * @param {object|null} [body]
   * @param {Record<string, string>|null} [extraHeaders]
   */
  async function requestWithHeaders(session, method, path, body = null, extraHeaders = null) {
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
      return res.json();
    }
    return res.json().catch(() => null);
  }

  function sessionFromApi() {
    const api = typeof API !== 'undefined' ? API : null;
    if (!api) throw new Error('API 未初始化');
    return { baseUrl: api.getBaseUrl(), token: api.getToken() };
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
    if (!key) throw new Error('缺少 Idempotency-Key');
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

  /**
   * 轮询 job 至终态或超时。
   * @param {string} tenantId
   * @param {string} jobId
   * @param {{ maxMs?: number, initialDelayMs?: number, maxDelayMs?: number, sleep?: (ms:number)=>Promise<void>, session?: object }} [opts]
   */
  async function pollSuggestJob(tenantId, jobId, opts = {}) {
    const maxMs = opts.maxMs ?? 60000;
    const maxDelayMs = opts.maxDelayMs ?? 4000;
    let delay = opts.initialDelayMs ?? 500;
    const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const started = Date.now();
    let last = null;

    while (Date.now() - started < maxMs) {
      last = await getSuggestJob(tenantId, jobId, opts.session);
      const status = String(last?.status || '').toLowerCase();
      if (status === 'succeeded' || status === 'failed' || status === 'expired') {
        return last;
      }
      await sleep(delay);
      delay = Math.min(maxDelayMs, Math.round(delay * 1.5));
    }
    const err = new Error('页面优化建议超时，请稍后重试');
    err.errorCode = 'SUGGEST_JOB_TIMEOUT';
    err.lastJob = last;
    throw err;
  }

  return {
    ENDPOINTS,
    createSuggestJob,
    getSuggestJob,
    getAgentResourceStatus,
    pollSuggestJob,
    requestWithHeaders,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorAPI;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorAPI = PageAdvisorAPI;
}
