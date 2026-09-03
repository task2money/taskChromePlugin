'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const OAuthPKCE = require('../lib/oauth-pkce.js');

describe('generateCodeVerifier', () => {
  it('produces 43-128 char base64url string (RFC 7636 §4.1)', () => {
    for (let i = 0; i < 20; i++) {
      const v = OAuthPKCE.generateCodeVerifier();
      assert.ok(v.length >= 43 && v.length <= 128, `length ${v.length}`);
      assert.match(v, /^[A-Za-z0-9_-]+$/);
    }
  });

  it('supports custom length', () => {
    const v = OAuthPKCE.generateCodeVerifier(43);
    assert.equal(v.length, 43);
  });
});

describe('generateCodeChallenge', () => {
  it('S256 challenge matches taskAuth verifyPKCECodeChallenge (sha256 base64url no pad)', async () => {
    const verifier = 'mBfQ8d2n3K9xVzLpWqR7sT5uY6iJhGfEaDcCvBnNmA1ZlXkHjPoeO';
    const challenge = await OAuthPKCE.generateCodeChallenge(verifier);
    // 与 Go 端 sha256.Sum256 + base64urlEncodeNoPad 一致
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
    assert.equal(challenge, expected);
    assert.equal(challenge.length, 43);
  });
});

describe('generateState', () => {
  it('produces unique opaque state', () => {
    const a = OAuthPKCE.generateState();
    const b = OAuthPKCE.generateState();
    assert.ok(a.length >= 16);
    assert.notEqual(a, b);
  });
});

describe('buildAuthorizeUrl', () => {
  it('builds authorize URL with all PKCE params and fixed client', () => {
    const url = OAuthPKCE.buildAuthorizeUrl({
      baseUrl: 'https://aidevpush.com',
      extensionId: 'knfffehmbkgkgablkedpniahimobgkgn',
      state: 'st-123',
      codeChallenge: 'challenge-43-chars-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const u = new URL(url);
    assert.equal(u.origin, 'https://aidevpush.com');
    assert.equal(u.pathname, '/api/oidc/authorize');
    assert.equal(u.searchParams.get('client_id'), 'chrome-extension');
    assert.equal(u.searchParams.get('redirect_uri'), 'chrome-extension://knfffehmbkgkgablkedpniahimobgkgn/oauth-callback.html');
    assert.equal(u.searchParams.get('response_type'), 'code');
    // OPT-20260824-052：请求 offline_access → 服务端签发 refresh token
    assert.equal(u.searchParams.get('scope'), 'openid offline_access');
    assert.equal(u.searchParams.get('state'), 'st-123');
    assert.equal(u.searchParams.get('code_challenge'), 'challenge-43-chars-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  });

  it('strips trailing slash from baseUrl', () => {
    const url = OAuthPKCE.buildAuthorizeUrl({
      baseUrl: 'https://aidevpush.com/',
      extensionId: 'id',
      state: 's',
      codeChallenge: 'c',
    });
    assert.ok(url.startsWith('https://aidevpush.com/api/oidc/authorize'));
  });
});

describe('exchangeCodeForToken', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs JSON body with client credentials + verifier, returns tokens', async () => {
    let seenUrl = null;
    let seenOpts = null;
    globalThis.fetch = async (url, opts) => {
      seenUrl = url;
      seenOpts = opts;
      return {
        ok: true,
        async json() {
          return { access_token: 'eyJ.rs256', id_token: 'eyJ.id', token_type: 'Bearer', expires_in: 3600 };
        },
        async text() { return JSON.stringify({ access_token: 'eyJ.rs256', id_token: 'eyJ.id', token_type: 'Bearer', expires_in: 3600 }); },
      };
    };

    const result = await OAuthPKCE.exchangeCodeForToken({
      baseUrl: 'https://aidevpush.com',
      code: 'auth-code-1',
      redirectUri: 'chrome-extension://knfffehmbkgkgablkedpniahimobgkgn/oauth-callback.html',
      codeVerifier: 'verifier-43-chars-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    assert.equal(seenUrl, 'https://aidevpush.com/api/oidc/token');
    assert.equal(seenOpts.method, 'POST');
    assert.equal(seenOpts.credentials, 'omit');
    assert.equal(seenOpts.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(seenOpts.body), {
      client_id: 'chrome-extension',
      client_secret: OAuthPKCE.CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: 'auth-code-1',
      redirect_uri: 'chrome-extension://knfffehmbkgkgablkedpniahimobgkgn/oauth-callback.html',
      code_verifier: 'verifier-43-chars-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    assert.equal(result.access_token, 'eyJ.rs256');
    assert.equal(result.expires_in, 3600);
  });

  it('surfaces readable error with detail when exchange fails', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      async json() {
        return { error: 'invalid_grant', error_description: 'invalid or expired authorization code' };
      },
      async text() { return JSON.stringify({ error: 'invalid_grant', error_description: 'invalid or expired authorization code' }); },
    });
    await assert.rejects(
      () => OAuthPKCE.exchangeCodeForToken({
        baseUrl: 'https://aidevpush.com', code: 'bad', redirectUri: 'r', codeVerifier: 'v'.repeat(43),
      }),
      /invalid_grant/,
    );
  });
});

describe('refreshAccessToken', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs refresh_token grant and returns rotated tokens', async () => {
    let seenUrl = null;
    let seenOpts = null;
    globalThis.fetch = async (url, opts) => {
      seenUrl = url;
      seenOpts = opts;
      return {
        ok: true,
        async json() {
          return {
            access_token: 'eyJ.new',
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: 'rotated-refresh-abc',
            id_token: 'eyJ.id',
          };
        },
        async text() { return JSON.stringify({ access_token: 'eyJ.new', refresh_token: 'rotated-refresh-abc' }); },
      };
    };

    const result = await OAuthPKCE.refreshAccessToken({
      baseUrl: 'https://aidevpush.com/',
      refreshToken: 'old-refresh-xyz',
    });

    assert.equal(seenUrl, 'https://aidevpush.com/api/oidc/token');
    assert.equal(seenOpts.method, 'POST');
    assert.equal(seenOpts.credentials, 'omit');
    assert.deepEqual(JSON.parse(seenOpts.body), {
      client_id: 'chrome-extension',
      client_secret: OAuthPKCE.CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh-xyz',
    });
    assert.equal(result.access_token, 'eyJ.new');
    assert.equal(result.refresh_token, 'rotated-refresh-abc');
  });

  it('throws readable error when refresh grant is rejected (rotated/replayed token)', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      async json() {
        return { error: 'invalid_grant', error_description: 'invalid or expired refresh token' };
      },
      async text() { return JSON.stringify({ error: 'invalid_grant', error_description: 'invalid or expired refresh token' }); },
    });
    await assert.rejects(
      () => OAuthPKCE.refreshAccessToken({ baseUrl: 'https://aidevpush.com', refreshToken: 'stale' }),
      /invalid_grant/,
    );
  });

  it('throws network error when fetch rejects', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    await assert.rejects(
      () => OAuthPKCE.refreshAccessToken({ baseUrl: 'https://aidevpush.com', refreshToken: 'x' }),
      /刷新网络失败/,
    );
  });
});

describe('fetchUserInfo', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('GETs userinfo with Bearer token', async () => {
    let seenUrl = null;
    let seenHeaders = null;
    let seenOpts = null;
    globalThis.fetch = async (url, opts) => {
      seenUrl = url;
      seenHeaders = opts.headers;
      seenOpts = opts;
      return {
        ok: true,
        async json() {
          return { sub: '9000000001', email: 'u@test.com', name: '软刀', preferred_username: '软刀' };
        },
        async text() { return JSON.stringify({ sub: '9000000001', email: 'u@test.com', name: '软刀', preferred_username: '软刀' }); },
      };
    };

    const user = await OAuthPKCE.fetchUserInfo('https://aidevpush.com', 'eyJ.token');
    assert.equal(seenUrl, 'https://aidevpush.com/api/oidc/userinfo');
    assert.equal(seenHeaders.Authorization, 'Bearer eyJ.token');
    assert.equal(seenOpts.credentials, 'omit');
    assert.equal(user.sub, '9000000001');
  });
});
