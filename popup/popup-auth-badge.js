/** Popup 登录角标定时刷新（从 popup-auth.js 拆出，行数门禁）。 */

  function applyExpiryHintToPopup(expiryHint) {
    const status = $('#popupStatus');
    if (!status) return;
    if (!expiryHint?.text) {
      // 已登录且无临近过期时保持隐藏（header 已显示用户）
      if ($('#headerUserArea')?.style.display !== 'none') {
        status.style.display = 'none';
        status.textContent = '';
        status.title = '';
      }
      return;
    }
    status.style.display = 'inline';
    status.textContent = expiryHint.text;
    status.className = expiryHint.level === 'critical' ? 'badge badge-disconnected' : 'badge badge-warning';
    status.title = tx('panelBadgeExpiringTitle');
  }

  async function refreshAuthBadgeOnly() {
    try {
      const r = await sendMessageWithTimeout({ action: 'getAuthStatus' }, 5000);
      if (!r?.success || !r.data) return;
      if (!r.data.token) {
        stopAuthBadgeTimer();
        showLoginUI();
        return;
      }
      if (r.data.expired) {
        stopAuthBadgeTimer();
        showTokenExpiredUI(r.data.username);
        return;
      }
      const hint = r.data.expiryHint || Storage.formatTokenExpiryHint(r.data.remainingSeconds);
      applyExpiryHintToPopup(hint);
    } catch (e) {
      console.warn('[TaskPlugin] popup 定时刷新登录态失败:', e.message);
    }
  }

  function startAuthBadgeTimer() {
    stopAuthBadgeTimer();
    if (typeof startDocumentVisibilityInterval === 'function') {
      authBadgeTimer = startDocumentVisibilityInterval(AUTH_BADGE_REFRESH_MS, () => refreshAuthBadgeOnly());
      return;
    }
    authBadgeTimer = setInterval(() => {
      refreshAuthBadgeOnly();
    }, AUTH_BADGE_REFRESH_MS);
  }

  function stopAuthBadgeTimer() {
    if (authBadgeTimer && typeof authBadgeTimer.stop === 'function') {
      authBadgeTimer.stop();
      authBadgeTimer = null;
      return;
    }
    if (authBadgeTimer) {
      clearInterval(authBadgeTimer);
      authBadgeTimer = null;
    }
  }
