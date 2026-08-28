/** Account expiry alarm (OPT-20260821-004 split). */
// ---- 账号过期主动检测 ----

const ACCOUNT_CHECK_ALARM_NAME = 'accountExpiryCheck';
const ACCOUNT_CHECK_INTERVAL_MIN = 30; // 每 30 分钟检查一次

/**
 * 启动定期账号过期检测 alarm。
 * MV3 Service Worker 可能随时被终止，alarm 会唤醒 SW 重新初始化。
 *
 * 注意：chrome.alarms 依赖 manifest "alarms" 权限。权限缺失时该 API 为 undefined，
 * 直接在顶层调用会抛 TypeError 导致 SW 启动失败、整个扩展 runtime 消息通道中断
 * （所有 chrome.runtime.sendMessage 超时）。因此此处与下方顶层 onAlarm listener
 * 都必须做权限守卫，权限缺失时仅降级跳过，不得抛出。
 */
function startAccountExpiryCheck() {
  if (typeof chrome.alarms === 'undefined') {
    console.warn('[taskChromePlugin] chrome.alarms 不可用（manifest 缺 alarms 权限），跳过账号过期检测');
    return;
  }
  chrome.alarms.get(ACCOUNT_CHECK_ALARM_NAME, (existing) => {
    if (!existing) {
      chrome.alarms.create(ACCOUNT_CHECK_ALARM_NAME, {
        delayInMinutes: 3,  // 首次启动 3 分钟后检查
        periodInMinutes: ACCOUNT_CHECK_INTERVAL_MIN,
      });
      console.log('[taskChromePlugin] 账号过期检测已启动（每30分钟）');
    }
  });
}

if (typeof chrome.alarms !== 'undefined') {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ACCOUNT_CHECK_ALARM_NAME) {
      checkAllAccountsForExpiry().catch((e) => {
        console.warn('[taskChromePlugin] 账号过期检测失败:', e.message || e);
      });
    }
  });
}

/**
 * 检查所有已保存账号的 token 有效性。
 * 对每个账号调用 /api/accounts/users/me/ 探测，401/403 表示失效。
 * 失效账号通过 postMessage 广播给所有页面。
 */
async function checkAllAccountsForExpiry() {
  let accounts = [];
  try {
    const list = await MultiAccount.listSavedAccounts();
    if (!Array.isArray(list) || list.length === 0) return;
    accounts = list;
  } catch (e) {
    console.warn('[taskChromePlugin] 获取已保存账号列表失败:', e.message || e);
    return;
  }

  const expiredAccounts = [];
  const baseUrl = (await Storage.getApiConfig()).baseUrl;

  for (const acct of accounts) {
    if (!acct.token || !acct.userId) continue;
    try {
      const resp = await fetch(`${baseUrl}/api/accounts/users/me/`, {
        method: 'GET',
        headers: {
          'Authorization': `Token ${acct.token}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.status === 401 || resp.status === 403) {
        expiredAccounts.push({
          userId: acct.userId,
          username: acct.username || '',
        });
      }
    } catch (e) {
      // 网络错误不视为过期（可能是离线），静默跳过
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        console.warn(`[taskChromePlugin] 账号 ${acct.username} token 检查超时`);
      }
    }
  }

  if (expiredAccounts.length > 0) {
    console.log(`[taskChromePlugin] 检测到 ${expiredAccounts.length} 个账号 token 已过期:`,
      expiredAccounts.map(a => a.username || a.userId).join(', '));
    // 只写 storage：各页经 onChanged 刷新。不再 tabs.query({}) 扇出。
    try {
      await MultiAccount.pruneSavedAccounts(expiredAccounts.map(a => a.userId));
    } catch (e) {
      console.warn('[taskChromePlugin] 过期账号槽位清理失败:', e?.message || e);
    }
  }
}
