/**
 * OAuth / OIDC 工具 — PKCE、token 交换
 * 用于 Chrome Extension 的 OIDC Authorization Code + PKCE 流程
 */

const OAuth = (() => {
  // taskAuth OIDC 端点（与 conf/auth/task-auth/config.yaml 中 issuer 一致）
  const DEFAULT_ISSUER = 'http://183.250.1.132:18081';
  const CLIENT_ID = 'chrome-extension';

  const ENDPOINTS = {
    authorize: '/api/oidc/authorize',
    token: '/api/oidc/token',
    userinfo: '/api/oidc/userinfo',
    discovery: '/.well-known/openid-configuration',
  };

  /**
   * 生成 PKCE code_verifier (43 字符的随机 base64url 字符串)
   */
  function generateCodeVerifier() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64urlEncode(bytes);
  }

  /**
   * 从 code_verifier 计算 S256 code_challenge
   */
  async function computeCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return base64urlEncode(new Uint8Array(hash));
  }

  /**
   * 生成随机 state 参数（防 CSRF）
   */
  function generateState() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return base64urlEncode(bytes);
  }

  /**
   * Uint8Array → base64url (no padding)
   */
  function base64urlEncode(buffer) {
    const binary = String.fromCharCode(...buffer);
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * 构建 OIDC Authorize URL
   */
  function buildAuthorizeURL(issuer, redirectURI, codeChallenge, state) {
    const base = (issuer || DEFAULT_ISSUER).replace(/\/+$/, '');
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectURI,
      response_type: 'code',
      scope: 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: state,
    });
    return `${base}${ENDPOINTS.authorize}?${params.toString()}`;
  }

  /**
   * 用 authorization_code 交换 token
   * POST /api/oidc/token
   */
  async function exchangeCodeForToken(issuer, code, redirectURI, codeVerifier, clientSecret) {
    const base = (issuer || DEFAULT_ISSUER).replace(/\/+$/, '');
    const url = `${base}${ENDPOINTS.token}`;

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: clientSecret || 'chrome-extension-dev-secret',
      code: code,
      redirect_uri: redirectURI,
      code_verifier: codeVerifier,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }

    return res.json();
  }

  /**
   * 获取 issuer（尝试从 OIDC Discovery 获取，失败则使用默认值）
   */
  async function resolveIssuer(baseUrl) {
    const base = (baseUrl || DEFAULT_ISSUER).replace(/\/+$/, '');
    try {
      const res = await fetch(`${base}${ENDPOINTS.discovery}`);
      if (res.ok) {
        const doc = await res.json();
        if (doc.issuer) return doc.issuer;
      }
    } catch (_) { /* fall through */ }
    return base;
  }

  /**
   * 使用 access_token 获取用户信息
   */
  async function fetchUserInfo(issuer, accessToken) {
    const base = (issuer || DEFAULT_ISSUER).replace(/\/+$/, '');
    const res = await fetch(`${base}${ENDPOINTS.userinfo}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`UserInfo failed (${res.status})`);
    }
    return res.json();
  }

  return {
    DEFAULT_ISSUER,
    CLIENT_ID,
    generateCodeVerifier,
    computeCodeChallenge,
    generateState,
    buildAuthorizeURL,
    exchangeCodeForToken,
    resolveIssuer,
    fetchUserInfo,
  };
})();
