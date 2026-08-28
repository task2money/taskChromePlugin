/** Login finalize + silent refresh (OPT-20260821-004 split). */
async function enrichTaskDataWithOwner(taskData) {
  if (!taskData || taskData.owner) return taskData;
  const mapping = await Storage.getEndpointMapping();
  if (mapping?.owner) {
    return { ...taskData, owner: String(mapping.owner) };
  }
  const cred = await Storage.getCredentials();
  if (cred.memberId) {
    return { ...taskData, owner: String(cred.memberId) };
  }
  return taskData;
}

function applyEndpointOwner(mapping) {
  if (mapping?.owner) {
    API.setOwner(mapping.owner);
  }
}

/**
 * 从消息或 storage 初始化 API（content script 可不传 baseUrl/token）
 */
async function initApiFromMessage(message = {}) {
  const cfg = await Storage.getApiConfig();
  const mapping = message.endpointMapping != null
    ? message.endpointMapping
    : await Storage.getEndpointMapping();
  const cred = await Storage.getCredentials();
  const baseUrl = message.baseUrl || cfg.baseUrl;
  const token = message.token || cfg.token;
  API.init(baseUrl, token, mapping, cred.userId || '');
  if (cred.userId) API.setUserId(cred.userId);
  applyEndpointOwner(mapping);
  return { baseUrl, token, mapping, cred, cfg };
}

/** 单标签/子 frame 消息超时：discarded/frozen 页上 sendMessage 可能永不 resolve */
const AUTH_BROADCAST_TAB_TIMEOUT_MS = 800;

/** 登录成功：持久化（带超时），靠 chrome.storage.onChanged 通知各页，绝不扇出全部标签页 */
async function completeLoginAndRespond(baseUrl, token, expiresIn, refreshToken, username, userId, memberId, result) {
  // 先写入内存会话，保证即便 storage 短暂失败也能继续
  API.init(baseUrl, token, null, userId || '');
  if (memberId) API.setOwner(memberId);

  const persistOpts = {
    saveApiConfig: (url, tok, exp, rt) => Storage.saveApiConfig(url, tok, exp, rt),
    saveCredentials: (name, uid, mid) => Storage.saveCredentials(name, uid, mid),
    baseUrl,
    token,
    expiresIn,
    refreshToken,
    username,
    userId,
    memberId,
    withTimeout,
    timeoutMs: 3000,
  };

  try {
    await finalizeLoginSuccess(persistOpts);
  } catch (e) {
    console.warn('[taskChromePlugin] 保存登录态失败/超时，后台重试:', e?.message || e);
    // 后台再试一次（无超时包装由 storage 自身决定）
    void persistLoginCredentials({ ...persistOpts, timeoutMs: 0 }).catch((err) => {
      console.warn('[taskChromePlugin] 登录态后台重试仍失败:', err?.message || err);
    });
  }
  return { success: true, data: result };
}

// OPT-20260808-024：旧登录（密码/访问令牌/Cookie 桥接）已移除。
// 登录态只经 OAuth2+PKCE 授权码流程获得（case 'oauthStart' / 'oauthCallback'）。

// ---- OAuth access token 静默续期（OPT-20260824-052）----
// access token 1h 过期；持 refresh_token（offline_access 签发，30 天轮换制）时，
// 过期即调 /api/oidc/token grant_type=refresh_token 静默换新，用户无需重新登录。
// 单飞锁：多页面并发触发（popup/panel/badge 定时轮询）共享同一次刷新。

let refreshInFlight = null; // { baseUrl, promise }

/**
 * 用持久化的 refresh token 静默续期并写回 storage。
 * @returns {Promise<{token: string, expiresIn: number} | null>} 无可刷新凭据返回 null；失败抛错
 */
async function silentRefreshToken() {
  const cfg = await Storage.getApiConfig();
  if (!cfg.token || !cfg.refreshToken) return null; // 无会话或旧版登录（无 refresh token）→ 不刷新
  const baseUrl = cfg.baseUrl;

  if (refreshInFlight && refreshInFlight.baseUrl === baseUrl) {
    return refreshInFlight.promise;
  }
  const promise = (async () => {
    const tokenRes = await OAuthPKCE.refreshAccessToken({
      baseUrl,
      refreshToken: cfg.refreshToken,
    });
    const newToken = tokenRes.access_token;
    if (!newToken) {
      throw new Error('OAuth 刷新未返回 access_token');
    }
    // 轮换制：服务端已撤销旧 refresh token，必须持久化新值
    await Storage.saveApiConfig(
      baseUrl,
      newToken,
      tokenRes.expires_in || 3600,
      tokenRes.refresh_token || cfg.refreshToken,
    );
    // 同步内存会话，页面后续 API 调用立即生效
    API.init(baseUrl, newToken, null);
    return { token: newToken, expiresIn: tokenRes.expires_in || 3600 };
  })()
    .catch((err) => {
      // 服务端明确拒绝（invalid_grant=已轮换/撤销/过期，invalid_client=凭据失效）
      // → refresh token 不可恢复，清空避免每次交互都发起必失败的刷新请求；
      // 网络错误保留 refreshToken（瞬时故障，下次重试）
      if (err && /invalid_grant|invalid_client/.test(err.message || '')) {
        Storage.saveApiConfig(baseUrl, '', 0).catch(() => {});
      }
      throw err;
    })
    .finally(() => {
      if (refreshInFlight && refreshInFlight.promise === promise) {
        refreshInFlight = null;
      }
    });
  refreshInFlight = { baseUrl, promise };
  return promise;
}
