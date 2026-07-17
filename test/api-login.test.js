'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const API = require('../lib/api.js');

describe('API login error helpers', () => {
  it('extractErrorDetail prefers error/detail/message/non_field_errors', () => {
    assert.equal(API.extractErrorDetail('{"error":"令牌无效或已过期"}'), '令牌无效或已过期');
    assert.equal(API.extractErrorDetail('{"detail":"forbidden"}'), 'forbidden');
    assert.equal(API.extractErrorDetail('{"message":"oops"}'), 'oops');
    assert.equal(
      API.extractErrorDetail('{"non_field_errors":["账号已被禁用"]}'),
      '账号已被禁用',
    );
    assert.equal(API.extractErrorDetail('not-json'), '');
  });

  it('formatHttpError surfaces readable detail without raw JSON dump', () => {
    assert.equal(
      API.formatHttpError('POST', '/api/x/', 401, '{"error":"账号与令牌不匹配"}'),
      '账号与令牌不匹配',
    );
    assert.match(
      API.formatHttpError('POST', '/api/x/', 500, 'plain'),
      /API POST \/api\/x\/ → 500: plain/,
    );
  });
});

describe('API.init token clearing', () => {
  it('empty string tokenOverride clears in-memory session token', () => {
    API.init('http://127.0.0.1:18081', 'old-session-token');
    assert.equal(API.getToken(), 'old-session-token');
    API.init('http://127.0.0.1:18081', '');
    assert.equal(API.getToken(), '');
  });

  it('clearSession clears token and userId', () => {
    API.init('http://127.0.0.1:18081', 'tok', null, 'uid-1');
    API.clearSession();
    assert.equal(API.getToken(), '');
    assert.equal(API.getUserId(), '');
  });
});

describe('loginWithAccessToken must not send Authorization', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    API.clearSession();
    API.init('http://example.test', 'stale-should-not-be-sent', null, '');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    API.clearSession();
  });

  it('POSTs body without Authorization header even if memory has stale token', async () => {
    let seenHeaders = null;
    let seenBody = null;
    globalThis.fetch = async (url, opts) => {
      seenHeaders = opts.headers || {};
      seenBody = opts.body;
      assert.match(String(url), /login-with-access-token/);
      return {
        ok: true,
        async json() {
          return { token: 'new-session', user: { id: '1' } };
        },
        async text() { return ''; },
      };
    };

    const data = await API.loginWithAccessToken('user@test.com', 'at_0123456789ab');
    assert.equal(data.token, 'new-session');
    assert.equal(seenHeaders.Authorization, undefined);
    assert.equal(seenHeaders['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(seenBody), {
      username: 'user@test.com',
      access_token: 'at_0123456789ab',
    });
    assert.equal(API.getToken(), 'new-session');
  });
});

/**
 * 回归：登录点击路径若 await 无超时的 storage，chrome.storage 挂起时按钮永远停在可点但无反馈。
 * 正确模式：先更新按钮态，saveBaseUrl 带超时，失败也继续发 login 消息。
 */
describe('popup login must not block on hanging saveBaseUrl', () => {
  it('continues login after saveBaseUrl times out', async () => {
    const { withTimeout } = require('../lib/async-timeout.js');
    const hangForever = () => new Promise(() => {});
    let loginCalled = false;

    async function handleTokenLoginLike() {
      let btnText = '🔓 登录';
      let disabled = false;
      disabled = true;
      btnText = '⏳ 登录中...';

      try {
        await withTimeout(hangForever(), 40, '保存服务器地址');
      } catch (_e) {
        /* continue */
      }

      loginCalled = true;
      disabled = false;
      btnText = '🔓 登录';
      return { btnText, disabled };
    }

    const result = await handleTokenLoginLike();
    assert.equal(loginCalled, true);
    assert.equal(result.disabled, false);
    assert.equal(result.btnText, '🔓 登录');
  });
});
