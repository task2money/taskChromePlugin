/**
 * 登录收尾 — 持久化会话后尽快向 Popup 返回 success。
 * 各页经 chrome.storage.onChanged 刷新，不再向全部标签页 sendMessage。
 */

function scheduleAuthBroadcast(broadcastFn) {
  try {
    Promise.resolve()
      .then(() => broadcastFn())
      .catch((e) => {
        console.warn('[taskChromePlugin] auth broadcast failed:', e?.message || e);
      });
  } catch (e) {
    console.warn('[taskChromePlugin] auth broadcast schedule failed:', e?.message || e);
  }
}

/**
 * 将登录结果写入 storage；可选 withTimeout，避免 chrome.storage 挂起拖死 SW 响应。
 */
async function persistLoginCredentials(opts) {
  const {
    saveApiConfig,
    saveCredentials,
    baseUrl,
    token,
    expiresIn,
    username,
    userId,
    memberId,
    withTimeout,
    timeoutMs = 3000,
  } = opts;

  if (typeof saveApiConfig !== 'function' || typeof saveCredentials !== 'function') {
    throw new Error('persistLoginCredentials: missing storage adapters');
  }
  if (!token) {
    throw new Error('persistLoginCredentials: missing token');
  }

  const work = async () => {
    await saveApiConfig(baseUrl, token, expiresIn);
    await saveCredentials(username || '', userId || '', memberId || '');
  };

  if (typeof withTimeout === 'function' && Number(timeoutMs) > 0) {
    await withTimeout(work(), timeoutMs, '保存登录态');
    return;
  }
  await work();
}

/**
 * 登录成功收尾：先持久化，再异步广播；调用方应立即 return success。
 */
async function finalizeLoginSuccess(opts) {
  await persistLoginCredentials(opts);
  scheduleAuthBroadcast(opts.broadcast || (() => {}));
  return { persisted: true };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    scheduleAuthBroadcast,
    persistLoginCredentials,
    finalizeLoginSuccess,
  };
}
