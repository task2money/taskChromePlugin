/**
 * 「网页优化」匿名每日试用 API 客户端。
 *
 * 未登录且未配置本机智能体的用户走这里：公开端点不带 Authorization，
 * 由服务端按插件安装指纹 + 客户端 IP + 全局每日池三层记账。
 * 同一次点击用同一个 Idempotency-Key，重放不会二次扣额度。
 */

'use strict';

const PageAdvisorTrialAPI = (() => {
  const APIHttp = (typeof module !== 'undefined' && module.exports)
    ? require('./api-http.js')
    : (typeof globalThis !== 'undefined' && globalThis.APIHttp) || {};

  const ENDPOINTS = {
    suggestJobs: '/api/page-advisor/v1/page-trials/suggest-jobs/',
    quota: '/api/page-advisor/v1/page-trials/quota/',
    // v233：匿名优化贴的只读入口，凭响应里一次性发放的 view token 读回。
    post: '/api/page-advisor/v1/page-trials/posts/{postId}/',
  };
  const FINGERPRINT_HEADER = 'X-Plugin-Fingerprint';
  const VIEW_TOKEN_HEADER = 'X-View-Token';

  function resolveBaseUrl(raw) {
    const base = String(raw || '').trim().replace(/\/+$/, '');
    if (!base) {
      const err = new Error(tx('apiServerUrlMissing'));
      err.errorCode = 'PA_BASE_URL_MISSING';
      throw err;
    }
    return base;
  }

  function requireFingerprint(raw) {
    const fp = String(raw || '').trim();
    if (!fp) {
      const err = new Error(tx('paTrialFingerprintRequired'));
      err.errorCode = 'PAGE_TRIAL_FINGERPRINT_MISSING';
      throw err;
    }
    return fp;
  }

  /** 与 PageAdvisorAPI 同口径：成功响应挂非枚举 _resolvedTraceId，失败带 status/errorCode/quota。 */
  function stampResolvedTraceId(payload, res, requestTraceId) {
    if (!payload || typeof payload !== 'object') return payload;
    const tid = APIHttp.resolveTraceId(res, requestTraceId, '')
      || String(requestTraceId || '').trim();
    if (!tid) return payload;
    Object.defineProperty(payload, '_resolvedTraceId', {
      value: tid,
      enumerable: false,
      configurable: true,
    });
    return payload;
  }

  /**
   * @param {string} baseUrl 网关地址（cfg.baseUrl）
   * @param {'GET'|'POST'} method
   * @param {string} path
   * @param {{ body?: object|null, fingerprint?: string, idempotencyKey?: string,
   *   headers?: Record<string, string> }} [opts]
   */
  async function request(baseUrl, method, path, opts = {}) {
    const base = resolveBaseUrl(baseUrl);
    const fingerprint = requireFingerprint(opts.fingerprint);
    const requestTraceId = APIHttp.newRequestTraceId();
    const headers = {
      'Content-Type': 'application/json',
      'X-Trace-Id': requestTraceId,
      [FINGERPRINT_HEADER]: fingerprint,
      ...(APIHttp.pluginIdentityHeaders ? APIHttp.pluginIdentityHeaders() : {}),
      ...(opts.headers && typeof opts.headers === 'object' ? opts.headers : {}),
    };
    const key = String(opts.idempotencyKey || '').trim();
    if (key) headers['Idempotency-Key'] = key;

    const fetchOpts = { method, headers };
    if (opts.body && method !== 'GET') fetchOpts.body = JSON.stringify(opts.body);

    const res = await APIHttp.fetchWithClientTrace(`${base}${path}`, fetchOpts, requestTraceId);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch (_) { /* not json */ }
      const err = new Error(APIHttp.formatHttpError(method, path, res.status, text));
      err.status = res.status;
      err.traceId = APIHttp.resolveTraceId(res, requestTraceId, text);
      err.errorCode = parsed?.error_code || parsed?.errorCode || '';
      err.detail = parsed?.detail || parsed?.message || '';
      err.quota = parsed?.quota || null;
      err.body = parsed;
      throw err;
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    return stampResolvedTraceId(data, res, requestTraceId);
  }

  /**
   * POST 一次匿名生成。body 与公开端点字段对齐（服务端还会再截断）。
   * @param {string} baseUrl
   * @param {{ page_url: string, page_title?: string, page_text?: string, dom_outline?: object[], locale?: string }} body
   * @param {string} fingerprint
   * @param {string} idempotencyKey
   */
  async function suggest(baseUrl, body, fingerprint, idempotencyKey) {
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new Error(tx('swMissingIdempotencyKey'));
    return request(baseUrl, 'POST', ENDPOINTS.suggestJobs, {
      body,
      fingerprint,
      idempotencyKey: key,
    });
  }

  /**
   * GET 今日剩余额度（enabled / remaining / daily_quota / per_ip_* / pool_* / resets_at）。
   */
  async function getQuota(baseUrl, fingerprint) {
    return request(baseUrl, 'GET', ENDPOINTS.quota, { fingerprint });
  }

  /**
   * GET 读回一条匿名优化贴（标题 / 建议 / 有效期 / 领取状态）。
   * 令牌错或帖子不存在都是 404；已领取/过期是 410。
   * @param {string} baseUrl
   * @param {string} postId
   * @param {string} viewToken
   * @param {string} fingerprint
   */
  async function getPost(baseUrl, postId, viewToken, fingerprint) {
    const id = String(postId || '').trim();
    const token = String(viewToken || '').trim();
    if (!id || !token) {
      const err = new Error(tx('paTrialPostTokenRequired'));
      err.errorCode = 'PAGE_TRIAL_POST_TOKEN_MISSING';
      throw err;
    }
    const path = ENDPOINTS.post.replace('{postId}', encodeURIComponent(id));
    return request(baseUrl, 'GET', path, {
      fingerprint,
      headers: { [VIEW_TOKEN_HEADER]: token },
    });
  }

  return {
    ENDPOINTS,
    FINGERPRINT_HEADER,
    VIEW_TOKEN_HEADER,
    resolveBaseUrl,
    suggest,
    getQuota,
    getPost,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorTrialAPI;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorTrialAPI = PageAdvisorTrialAPI;
}
