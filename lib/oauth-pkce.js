/**
 * OAuth2 + PKCE 授权码流（OPT-20260808-024；refresh token OPT-20260824-052）
 *
 * 对接 taskAuth /api/oidc/* 端点：
 * - authorize: GET {base}/api/oidc/authorize?client_id=chrome-extension&redirect_uri=chrome-extension://<id>/oauth-callback.html&response_type=code&scope=openid+offline_access&state=...&code_challenge=...&code_challenge_method=S256
 *   未登录时 taskAuth 重定向到网页登录页，登录成功后回跳 redirect_uri 携带 code+state。
 * - token:    POST {base}/api/oidc/token  JSON {client_id, client_secret, grant_type:authorization_code, code, redirect_uri, code_verifier}
 *   返回 {access_token, id_token, token_type:"Bearer", expires_in:3600}（RS256 JWT）；
 *   请求 offline_access 时额外返回 refresh_token（TTL 30 天，轮换制）。
 * - token:    POST {base}/api/oidc/token  JSON {client_id, client_secret, grant_type:refresh_token, refresh_token}
 *   静默续期：返回新 access_token + 轮换后的新 refresh_token（旧 token 服务端撤销）。
 * - userinfo: GET  {base}/api/oidc/userinfo  Bearer <access_token> → {sub, email, email_verified, name, preferred_username}
 *
 * PKCE 与 taskAuth verifyPKCECodeChallenge 对齐：S256 = base64url(无 padding) SHA-256(verifier)。
 * 无 Chrome API / DOM 硬依赖，可被单测直接加载。
 */
(function initOAuthPKCE(global) {
  'use strict';

  /** 客户端注册（taskAuth conf bootstrap）：同 manifest 内嵌 client_id */
  const CLIENT_ID = 'chrome-extension';
  const CLIENT_SECRET = 'chrome-extension-dev-secret';
  const REDIRECT_PATH = '/oauth-callback.html';

  const DEFAULT_VERIFIER_LENGTH = 64; // 43-128，取 64 满足 taskAuth 校验区间

  const B64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  /** RFC 7636 §4.1：43-128 个 base64url unreserved 字符的随机串 */
  function generateCodeVerifier(length) {
    const len = length || DEFAULT_VERIFIER_LENGTH;
    const bytes = new Uint8Array(len);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    let out = '';
    for (let i = 0; i < len; i++) out += B64URL_CHARS[bytes[i] % B64URL_CHARS.length];
    return out;
  }

  /**
   * RFC 7636 §4.2：S256 challenge = base64url(无 padding) SHA-256(verifier)。
   * 与 taskAuth verifyPKCECodeChallenge 算法完全一致；SW 内 crypto.subtle 异步，统一返回 Promise。
   */
  async function generateCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    let digest;
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    } else {
      digest = require('node:crypto').createHash('sha256').update(data).digest();
    }
    return bytesToBase64Url(digest);
  }

  function bytesToBase64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function btoa(str) {
    if (typeof global.btoa === 'function') return global.btoa(str);
    // Node 单测路径
    return Buffer.from(str, 'binary').toString('base64');
  }

  /** 防 CSRF 随机 state */
  function generateState() {
    return generateCodeVerifier(32);
  }

  /**
   * 构建 authorize URL
   * @param {{baseUrl: string, extensionId: string, state: string, codeChallenge: string}} opts
   */
  function buildAuthorizeUrl(opts) {
    const base = String(opts.baseUrl || '').replace(/\/+$/, '');
    const redirectUri = `chrome-extension://${opts.extensionId}${REDIRECT_PATH}`;
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      // offline_access → 服务端签发 refresh token（access token 1h 过期后可静默续期，免重复登录）
      scope: 'openid offline_access',
      state: opts.state,
      code_challenge: opts.codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${base}/api/oidc/authorize?${params.toString()}`;
  }

  /** 通用 token 端点 POST（authorization_code / refresh_token 两个 grant 共用错误处理） */
  async function postTokenRequest(base, body, label) {
    let resp;
    try {
      resp = await fetch(`${base}/api/oidc/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`OAuth ${label}网络失败: ${err && err.message}`);
    }
    const text = await resp.text().catch(() => '');
    if (!resp.ok) {
      let error = '';
      let errorDescription = '';
      try {
        const j = JSON.parse(text);
        error = j.error || '';
        errorDescription = j.error_description || '';
      } catch (_) { /* noop */ }
      const detail = [error, errorDescription].filter(Boolean).join(': ');
      throw new Error(`OAuth ${label}失败 (${resp.status}): ${detail || text || '未知错误'}`);
    }
    return JSON.parse(text || '{}');
  }

  /**
   * 用授权码换 token（taskAuth handleOidcToken：JSON 或 form，强制校验 client_secret + code_verifier）
   * @param {{baseUrl: string, code: string, redirectUri: string, codeVerifier: string}} opts
   * @returns {Promise<{access_token: string, id_token?: string, token_type: string, expires_in: number, refresh_token?: string}>}
   */
  async function exchangeCodeForToken(opts) {
    const base = String(opts.baseUrl || '').replace(/\/+$/, '');
    const body = {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.codeVerifier,
    };
    return postTokenRequest(base, body, 'token 交换');
  }

  /**
   * 用 refresh token 静默续期（grant_type=refresh_token，轮换制）。
   * @param {{baseUrl: string, refreshToken: string}} opts
   * @returns {Promise<{access_token: string, id_token?: string, token_type: string, expires_in: number, refresh_token?: string}>}
   */
  async function refreshAccessToken(opts) {
    const base = String(opts.baseUrl || '').replace(/\/+$/, '');
    const body = {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: opts.refreshToken,
    };
    return postTokenRequest(base, body, 'token 刷新');
  }

  /**
   * 拉取用户信息
   * @param {string} baseUrl
   * @param {string} accessToken RS256 JWT
   * @returns {Promise<{sub: string, email?: string, email_verified?: boolean, name?: string, preferred_username?: string}>}
   */
  async function fetchUserInfo(baseUrl, accessToken) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    let resp;
    try {
      resp = await fetch(`${base}/api/oidc/userinfo`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      throw new Error(`OAuth userinfo 网络失败: ${err && err.message}`);
    }
    const text = await resp.text().catch(() => '');
    if (!resp.ok) {
      throw new Error(`OAuth userinfo 失败 (${resp.status}): ${text || '未知错误'}`);
    }
    return JSON.parse(text || '{}');
  }

  const OAuthPKCE = {
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_PATH,
    generateCodeVerifier,
    generateCodeChallenge,
    generateState,
    buildAuthorizeUrl,
    exchangeCodeForToken,
    refreshAccessToken,
    fetchUserInfo,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = OAuthPKCE;
  }
  if (global) {
    global.OAuthPKCE = OAuthPKCE;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
