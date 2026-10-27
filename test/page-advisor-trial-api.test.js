'use strict';

/**
 * 匿名每日试用 API 客户端：公开端点、不带 Authorization、指纹与幂等键必带。
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

require('./helpers/txRuntime.js').installTxRuntime();

const PageAdvisorTrialAPI = require('../lib/page-advisor-trial-api.js');

const BASE = 'https://example.test';

function jsonResponse(body, status = 200, traceHeader = 'trace-header-1') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === 'content-type') return 'application/json';
        if (String(name).toLowerCase() === 'x-trace-id') return traceHeader;
        return '';
      },
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('page-advisor-trial-api 复用公开试用端点', () => {
  it('端点与网关公开路由一致', () => {
    assert.equal(
      PageAdvisorTrialAPI.ENDPOINTS.suggestJobs,
      '/api/page-advisor/v1/page-trials/suggest-jobs/',
    );
    assert.equal(PageAdvisorTrialAPI.ENDPOINTS.quota, '/api/page-advisor/v1/page-trials/quota/');
    assert.equal(PageAdvisorTrialAPI.FINGERPRINT_HEADER, 'X-Plugin-Fingerprint');
  });
});

describe('page-advisor-trial-api 请求（mocked fetch）', () => {
  let origFetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('POST 带指纹与幂等键、不带 Authorization，并回传建议与额度', async () => {
    let seen;
    globalThis.fetch = async (url, opts) => {
      seen = { url: String(url), opts };
      return jsonResponse({
        trial_id: 'pt-1',
        suggestions: [{ id: 's1', title: '改标题' }],
        model: 'deepseek-chat',
        replayed: false,
        quota: { enabled: true, remaining: 2, daily_quota: 3, resets_at: '2026-10-27T16:00:00Z' },
      });
    };

    const data = await PageAdvisorTrialAPI.suggest(
      `${BASE}/`,
      {
        fingerprint: 'pf_body',
        page_url: 'https://shop.test/p',
        page_title: '商品页',
        page_text: '正文',
        dom_outline: [{ tag: 'h1' }],
        locale: 'zh-CN',
      },
      'pf_test_1',
      'ik-trial-1',
    );

    assert.equal(seen.url, `${BASE}/api/page-advisor/v1/page-trials/suggest-jobs/`);
    assert.equal(seen.opts.method, 'POST');
    assert.equal(seen.opts.headers['X-Plugin-Fingerprint'], 'pf_test_1');
    assert.equal(seen.opts.headers['Idempotency-Key'], 'ik-trial-1');
    assert.ok(seen.opts.headers['X-Trace-Id'], '每次请求都带 X-Trace-Id');
    assert.equal(seen.opts.headers.Authorization, undefined, '公开端点不得带 Authorization');
    assert.equal(JSON.parse(seen.opts.body).page_url, 'https://shop.test/p');
    assert.equal(data.trial_id, 'pt-1');
    assert.equal(data.quota.remaining, 2);
    assert.equal(data._resolvedTraceId, 'trace-header-1');
  });

  it('429 额度用尽：错误对象带 status/errorCode/detail/quota/traceId', async () => {
    globalThis.fetch = async () => jsonResponse({
      error_code: 'page_trial_quota_exceeded',
      detail: '今日试用次数已用完',
      trace_id: 'trace-429',
      quota: { enabled: true, remaining: 0, daily_quota: 3 },
    }, 429, '');

    await assert.rejects(
      () => PageAdvisorTrialAPI.suggest(BASE, { page_url: 'https://shop.test/p' }, 'pf_1', 'ik-1'),
      (err) => {
        assert.equal(err.status, 429);
        assert.equal(err.errorCode, 'page_trial_quota_exceeded');
        assert.equal(err.detail, '今日试用次数已用完');
        assert.equal(err.traceId, 'trace-429');
        assert.equal(err.quota.remaining, 0);
        return true;
      },
    );
  });

  it('GET 额度也只带指纹头，不带 Authorization', async () => {
    let seen;
    globalThis.fetch = async (url, opts) => {
      seen = { url: String(url), opts };
      return jsonResponse({ enabled: true, remaining: 3, daily_quota: 3 });
    };

    const quota = await PageAdvisorTrialAPI.getQuota(BASE, 'pf_test_2');

    assert.equal(seen.url, `${BASE}/api/page-advisor/v1/page-trials/quota/`);
    assert.equal(seen.opts.method, 'GET');
    assert.equal(seen.opts.headers['X-Plugin-Fingerprint'], 'pf_test_2');
    assert.equal(seen.opts.headers.Authorization, undefined);
    assert.equal(seen.opts.body, undefined);
    assert.equal(quota.remaining, 3);
  });

  it('缺少指纹或幂等键：本地就拒绝，不发请求', async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return jsonResponse({});
    };

    await assert.rejects(
      () => PageAdvisorTrialAPI.suggest(BASE, { page_url: 'https://shop.test/p' }, '', 'ik-1'),
      (err) => err.errorCode === 'PAGE_TRIAL_FINGERPRINT_MISSING',
    );
    await assert.rejects(
      () => PageAdvisorTrialAPI.suggest(BASE, { page_url: 'https://shop.test/p' }, 'pf_1', ''),
      /Idempotency-Key/,
    );
    await assert.rejects(
      () => PageAdvisorTrialAPI.getQuota(BASE, '  '),
      (err) => err.errorCode === 'PAGE_TRIAL_FINGERPRINT_MISSING',
    );
    assert.equal(called, false, '本地拒绝时不得发请求');
  });

  it('缺少网关地址：本地拒绝', async () => {
    await assert.rejects(
      () => PageAdvisorTrialAPI.getQuota('', 'pf_1'),
      (err) => err.errorCode === 'PA_BASE_URL_MISSING',
    );
  });

  it('匿名请求携带插件版本头（chrome 可用时；设计最后调用时间）', async () => {
    const origChrome = globalThis.chrome;
    globalThis.chrome = { runtime: { getManifest: () => ({ version: '1.8.282' }) } };
    let seen;
    globalThis.fetch = async (url, opts) => {
      seen = { url: String(url), opts };
      return jsonResponse({ enabled: true, remaining: 1, daily_quota: 3 });
    };
    try {
      await PageAdvisorTrialAPI.getQuota(BASE, 'pf_test_3');
    } finally {
      globalThis.chrome = origChrome;
    }
    assert.equal(seen.opts.headers['X-Plugin-Key'], 'chrome_extension');
    assert.equal(seen.opts.headers['X-Plugin-Version'], '1.8.282');
    assert.equal(seen.opts.headers.Authorization, undefined);
  });
});
