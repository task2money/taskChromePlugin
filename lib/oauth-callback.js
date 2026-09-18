/**
 * OAuth2+PKCE 回调页逻辑（OPT-20260808-024）
 *
 * 流程：taskAuth 授权成功后 302 回跳 chrome-extension://<id>/oauth-callback.html?code=...&state=...
 * 本脚本：解析 code/state → 本地 storage 校验 state（防 CSRF）→ 通知 SW 完成 token 交换。
 * 无 DOM 硬依赖（可注入），支持单测与真实页面两种运行形态。
 */
(function initOAuthCallback(global) {
  'use strict';

  const SESSION_KEY = 'oauthPkceSession';
  const SESSION_TTL_MS = 5 * 60 * 1000; // 授权页停留上限 5 分钟

  /**
   * @param {{ location?: {search: string}, chrome?: object, storageGet?: Function, sendMessage?: Function, render?: Function }} deps
   * @returns {Promise<{status: 'ok'|'error', message: string}>}
   */
  async function handleCallback(deps) {
    const D = deps || {};
    const chromeLike = D.chrome || (typeof global.chrome !== 'undefined' ? global.chrome : null);
    const storageGet = D.storageGet || (() => Promise.resolve(null));
    const sendMessage = D.sendMessage || (() => Promise.resolve({ success: false }));
    const render = D.render || (() => {});

    const rawQuery = String(D.location?.search || (typeof global.location !== 'undefined' ? global.location.search : ''));
    const qs = new URLSearchParams(rawQuery.startsWith('?') ? rawQuery.slice(1) : rawQuery);
    const code = qs.get('code') || '';
    const state = qs.get('state') || '';
    const error = qs.get('error') || '';
    const errorDescription = qs.get('error_description') || '';

    // taskAuth 拒绝授权（如 client 未注册）时以 error 参数回跳
    if (error) {
      const msg = tx('oauthCallbackDenied', { reason: errorDescription || error });
      render({ status: 'error', message: msg });
      return { status: 'error', message: msg };
    }
    if (!code || !state) {
      const msg = tx('oauthCallbackNoCodeState');
      render({ status: 'error', message: msg });
      return { status: 'error', message: msg };
    }

    // state 校验（防 CSRF）：与 oauthStart 时存入的会话比对
    let session = null;
    try {
      const stored = await storageGet();
      session = stored && stored[SESSION_KEY] ? stored[SESSION_KEY] : null;
    } catch (_) { /* storage 不可用按失败处理 */ }
    if (!session || session.state !== state) {
      const msg = tx('oauthCallbackStateMismatch');
      render({ status: 'error', message: msg });
      return { status: 'error', message: msg };
    }
    if (session.createdAt && Date.now() - session.createdAt > SESSION_TTL_MS) {
      const msg = tx('oauthCallbackSessionExpired');
      render({ status: 'error', message: msg });
      return { status: 'error', message: msg };
    }

    // 通知 SW 完成 token 交换 + 持久化（tabId 用于关闭本页）
    let res;
    try {
      res = await sendMessage({ action: 'oauthCallback', code, state, tabId: D.tabId });
    } catch (e) {
      const msg = tx('oauthCallbackExchangeFailed', {
        reason: e?.message || tx('oauthCallbackSwNoResponse'),
      });
      render({ status: 'error', message: msg });
      return { status: 'error', message: msg };
    }

    if (res && res.success) {
      const msg = tx('oauthCallbackSuccess');
      render({ status: 'ok', message: msg });
      return { status: 'ok', message: msg };
    }
    const msg = tx('oauthCallbackFailed', {
      reason: res?.error || tx('oauthCallbackUnknownError'),
    });
    render({ status: 'error', message: msg });
    return { status: 'error', message: msg };
  }

  const OAuthCallback = {
    SESSION_KEY,
    SESSION_TTL_MS,
    handleCallback,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = OAuthCallback;
  }
  if (global) {
    global.OAuthCallback = OAuthCallback;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
