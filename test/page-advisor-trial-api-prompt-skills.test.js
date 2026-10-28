'use strict';

/**
 * 公开提示词目录客户端：GET /api/page-advisor/v1/page-trials/prompt-skills/
 *
 * 该端点服务端不按安装指纹记账（公开只读目录），故请求必须不带
 * X-Plugin-Fingerprint；但仍带 X-Trace-Id 便于排障。指纹开关是请求级选项
 * （默认 true），其余试用端点行为不得改变。
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

require('./helpers/txRuntime.js').installTxRuntime();

const PageAdvisorTrialAPI = require('../lib/page-advisor-trial-api.js');

const BASE = 'https://example.test';

function jsonResponse(body, status = 200, traceHeader = 'trace-header-9') {
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

function headerNames(opts) {
  return Object.keys(opts && opts.headers ? opts.headers : {}).map((k) => k.toLowerCase());
}

const CATALOG = {
  default_skill_id: 'sys-seo',
  skills: [
    { id: 'sys-seo', title: 'SEO 默认', tendency: 'seo', runtime: 'rewrite' },
    { id: 'sys-a11y', title: '无障碍巡检', tendency: 'a11y', runtime: 'audit' },
  ],
};

describe('page-advisor-trial-api 公开提示词目录', () => {
  let origFetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('端点常量与网关公开路由一致', () => {
    assert.equal(
      PageAdvisorTrialAPI.ENDPOINTS.promptSkills,
      '/api/page-advisor/v1/page-trials/prompt-skills/',
    );
  });

  it('getPromptSkills：带 X-Trace-Id，不带 X-Plugin-Fingerprint 与 Authorization', async () => {
    let seen;
    globalThis.fetch = async (url, opts) => {
      seen = { url: String(url), opts };
      return jsonResponse(CATALOG);
    };

    // 注意：调用方根本不提供指纹——缺指纹也不能因此抛错。
    const data = await PageAdvisorTrialAPI.getPromptSkills(`${BASE}/`);

    assert.equal(seen.url, `${BASE}/api/page-advisor/v1/page-trials/prompt-skills/`);
    assert.equal(seen.opts.method, 'GET');
    assert.ok(seen.opts.headers['X-Trace-Id'], '公开目录请求仍须带 X-Trace-Id');
    assert.equal(
      headerNames(seen.opts).includes('x-plugin-fingerprint'),
      false,
      '公开提示词目录不得携带 X-Plugin-Fingerprint',
    );
    assert.equal(seen.opts.headers.Authorization, undefined, '公开端点不得带 Authorization');
    assert.equal(data.default_skill_id, 'sys-seo');
    assert.deepEqual(data.skills.map((s) => s.id), ['sys-seo', 'sys-a11y']);
    assert.equal(data._resolvedTraceId, 'trace-header-9');
  });

  it('指纹开关默认仍为 true：getQuota 照旧带 X-Plugin-Fingerprint', async () => {
    let seen;
    globalThis.fetch = async (url, opts) => {
      seen = { url: String(url), opts };
      return jsonResponse({ enabled: true, remaining: 2 });
    };

    await PageAdvisorTrialAPI.getQuota(BASE, 'pf_quota_1');

    assert.equal(seen.url, `${BASE}/api/page-advisor/v1/page-trials/quota/`);
    assert.equal(seen.opts.headers['X-Plugin-Fingerprint'], 'pf_quota_1');
    assert.ok(seen.opts.headers['X-Trace-Id']);
  });

  it('getPromptSkills：503 目录不可用按 HTTP 错误抛出（带错误码与 traceId）', async () => {
    globalThis.fetch = async () => jsonResponse(
      { error_code: 'prompt_catalog_unavailable', detail: 'catalog not configured', trace_id: 'tid-503' },
      503,
      'tid-503',
    );

    await assert.rejects(
      () => PageAdvisorTrialAPI.getPromptSkills(BASE),
      (err) => {
        assert.equal(err.status, 503);
        assert.equal(err.errorCode, 'prompt_catalog_unavailable');
        assert.equal(err.traceId, 'tid-503');
        return true;
      },
    );
  });
});
