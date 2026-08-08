'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const OAuthCallback = require('../lib/oauth-callback.js');

const SESSION_KEY = OAuthCallback.SESSION_KEY;

function makeDeps({ search, session, sendResult, storageError }) {
  const rendered = [];
  return {
    deps: {
      location: { search },
      // storageGet 语义 = chrome.storage.local.get(SESSION_KEY)：返回 { [SESSION_KEY]: {...} } 或 {}
      storageGet: () => (storageError ? Promise.reject(storageError) : Promise.resolve(session ? { [SESSION_KEY]: session } : {})),
      sendMessage: (msg) => Promise.resolve(sendResult(msg)),
      render: (r) => rendered.push(r),
    },
    rendered,
  };
}

describe('oauth-callback handleCallback', () => {
  it('error param → renders failure without storage/message calls', async () => {
    const { deps, rendered } = makeDeps({
      search: '?error=unauthorized_client&error_description=client+not+registered',
      session: null,
      sendResult: () => { throw new Error('should not be called'); },
    });
    const r = await OAuthCallback.handleCallback(deps);
    assert.equal(r.status, 'error');
    assert.match(r.message, /client not registered/);
    assert.equal(rendered.length, 1);
  });

  it('missing code/state → renders failure', async () => {
    const { deps, rendered } = makeDeps({ search: '?foo=1', session: null, sendResult: () => ({ success: true }) });
    const r = await OAuthCallback.handleCallback(deps);
    assert.equal(r.status, 'error');
    assert.match(r.message, /code\/state/);
    assert.equal(rendered.length, 1);
  });

  it('state mismatch → rejects (CSRF)', async () => {
    const { deps, rendered } = makeDeps({
      search: '?code=c1&state=evil-state',
      session: { state: 'good-state', verifier: 'v', baseUrl: 'https://aidevpush.com', createdAt: Date.now() },
      sendResult: () => { throw new Error('should not be called'); },
    });
    const r = await OAuthCallback.handleCallback(deps);
    assert.equal(r.status, 'error');
    assert.match(r.message, /state 校验失败/);
    assert.equal(rendered.length, 1);
  });

  it('expired session → rejects', async () => {
    const { deps } = makeDeps({
      search: '?code=c1&state=s1',
      session: { state: 's1', verifier: 'v', baseUrl: 'b', createdAt: Date.now() - 6 * 60 * 1000 },
      sendResult: () => ({ success: true }),
    });
    const r = await OAuthCallback.handleCallback(deps);
    assert.equal(r.status, 'error');
    assert.match(r.message, /已过期/);
  });

  it('valid code+state → sends oauthCallback message with code/state/tabId', async () => {
    let sent = null;
    const { deps, rendered } = makeDeps({
      search: '?code=auth-code-9&state=s-42',
      session: { state: 's-42', verifier: 'v', baseUrl: 'b', createdAt: Date.now() },
      sendResult: (msg) => { sent = msg; return { success: true }; },
    });
    deps.tabId = 7;
    const r = await OAuthCallback.handleCallback(deps);
    assert.equal(r.status, 'ok');
    assert.deepEqual(sent, { action: 'oauthCallback', code: 'auth-code-9', state: 's-42', tabId: 7 });
    assert.equal(rendered[0].message, '✅ 登录成功，可关闭此页面');
  });

  it('SW returns failure → surfaces error', async () => {
    const { deps, rendered } = makeDeps({
      search: '?code=c1&state=s1',
      session: { state: 's1', verifier: 'v', baseUrl: 'b', createdAt: Date.now() },
      sendResult: () => ({ success: false, error: 'token 交换失败' }),
    });
    const r = await OAuthCallback.handleCallback(deps);
    assert.equal(r.status, 'error');
    assert.match(r.message, /token 交换失败/);
    assert.equal(rendered.length, 1);
  });
});
