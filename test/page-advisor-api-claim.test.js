'use strict';

/**
 * 「领取任务贴」客户端（v233）：把匿名帖复制到登录用户的项目。
 * 走登录态 Authorization + 只读令牌头 + Idempotency-Key，三者缺一不可。
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

require('./helpers/txRuntime.js').installTxRuntime();

const PageAdvisorAPI = require('../lib/page-advisor-api.js');
const APIHttp = require('../lib/api-http.js');

const SESSION = { baseUrl: 'https://example.test', token: 'tok-session' };

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === 'content-type') return 'application/json';
        if (String(name).toLowerCase() === 'x-trace-id') return 'trace-claim-1';
        return '';
      },
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('PageAdvisorAPI.claimPageTrialPost', () => {
  let original;

  beforeEach(() => {
    original = APIHttp.fetchWithClientTrace;
  });

  afterEach(() => {
    APIHttp.fetchWithClientTrace = original;
  });

  it('POST 领取：路径含租户与帖 id，带令牌头、幂等键与登录态 Authorization', async () => {
    let seen;
    APIHttp.fetchWithClientTrace = async (url, opts) => {
      seen = { url: String(url), opts };
      return jsonResponse({
        post_id: 'landing-1',
        task_id: 'task-1',
        project_id: 'p-1',
        project_name: '我的项目',
        workspace_id: 'ws-1',
        already_claimed: false,
        trace_id: 'trace-claim-1',
      }, 201);
    };

    const data = await PageAdvisorAPI.claimPageTrialPost(
      't-1', 'post-1', 'tok-view', 'idem-1', SESSION,
    );

    assert.equal(
      seen.url,
      'https://example.test/api/page-advisor/v1/tenant_id/t-1/page-trial-posts/post-1/claim/',
    );
    assert.equal(seen.opts.method, 'POST');
    assert.equal(seen.opts.headers['X-View-Token'], 'tok-view');
    assert.equal(seen.opts.headers['Idempotency-Key'], 'idem-1');
    // 旧式会话令牌走 `Token` 前缀（api-http buildAuthorizationHeader）；JWT 才走 Bearer。
    assert.equal(seen.opts.headers.Authorization, 'Token tok-session');
    assert.equal(data.project_name, '我的项目');
    assert.equal(data.already_claimed, false);
  });

  it('缺令牌 / 缺租户 / 缺幂等键：本地拒绝，不发请求', async () => {
    let called = false;
    APIHttp.fetchWithClientTrace = async () => {
      called = true;
      return jsonResponse({});
    };
    await assert.rejects(
      () => PageAdvisorAPI.claimPageTrialPost('t-1', 'post-1', '', 'idem-1', SESSION),
      (err) => err.errorCode === 'PAGE_TRIAL_POST_TOKEN_MISSING',
    );
    await assert.rejects(
      () => PageAdvisorAPI.claimPageTrialPost('', 'post-1', 'tok', 'idem-1', SESSION),
      /缺少建议贴|Missing the post/,
    );
    await assert.rejects(
      () => PageAdvisorAPI.claimPageTrialPost('t-1', 'post-1', 'tok', '', SESSION),
      /Idempotency-Key/,
    );
    assert.equal(called, false);
  });

  it('已领取 / 已过期：状态码与错误码原样上抛，调用方据此清掉本地入口', async () => {
    APIHttp.fetchWithClientTrace = async () => jsonResponse({
      error_code: 'page_trial_post_claimed',
      detail: '该建议贴已被领取',
    }, 410);
    await assert.rejects(
      () => PageAdvisorAPI.claimPageTrialPost('t-1', 'post-1', 'tok', 'idem-1', SESSION),
      (err) => {
        assert.equal(err.status, 410);
        assert.equal(err.errorCode, 'page_trial_post_claimed');
        return true;
      },
    );

    APIHttp.fetchWithClientTrace = async () => jsonResponse({
      error_code: 'page_trial_claim_forbidden',
    }, 403);
    await assert.rejects(
      () => PageAdvisorAPI.claimPageTrialPost('t-1', 'post-1', 'tok', 'idem-1', SESSION),
      (err) => err.status === 403 && err.errorCode === 'page_trial_claim_forbidden',
    );
  });
});
