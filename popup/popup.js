/**
 * Popup 脚本 — 账号+令牌登录、连接状态、请求快速预览
 * 任务创建请使用 DevTools Panel (F12 → TaskPlugin)
 */

const Popup = (() => {
  const $ = (sel) => document.querySelector(sel);

  let capturedRequests = [];
  let selectedReqId = null;
  let authBadgeTimer = null;
  const AUTH_BADGE_REFRESH_MS = 60 * 1000;

  /**
   * 带超时的 chrome.runtime.sendMessage 封装
   * 防止 Service Worker 未就绪时消息无限挂起导致 popup 卡死
   */
  function sendMessageWithTimeout(action, timeoutMs = 3000) {
    const race = (typeof withTimeout === 'function')
      ? withTimeout
      : (p, ms, label) => Promise.race([
        p,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label || '操作'}超时`)), ms)),
      ]);

    try {
      return race(chrome.runtime.sendMessage(action), timeoutMs, `消息(${action.action || action})`);
    } catch (syncErr) {
      return Promise.reject(syncErr);
    }
  }

  let initRetryTimer = null;
  let eventsBound = false;
  const STATE_CHECK_TIMEOUT = 5000; // 登录状态检查最长 5 秒
  const STORAGE_READ_TIMEOUT = 2000; // storage 读取最长 2 秒

  function hideLoadingUI() {
    if (initRetryTimer) {
      clearTimeout(initRetryTimer);
      initRetryTimer = null;
    }
    const spinner = $('#loadingSpinner');
    if (spinner) spinner.style.display = 'none';
    const retryBtn = $('#btnRetryInit');
    if (retryBtn) retryBtn.style.display = 'none';
  }

  function isStillShowingLoadingOnly() {
    const spinner = $('#loadingSpinner');
    const loginSec = $('#loginSection');
    const devGuide = $('#devtoolsGuide');
    const shortcutsSec = $('#shortcutsSection');
    const reqSec = $('#requestsSection');
    const userGuideSec = $('#popupGuideSection');
    const spinnerVisible = spinner && spinner.style.display !== 'none';
    const loginHidden = !loginSec || loginSec.style.display === 'none';
    const guideHidden = !devGuide || devGuide.style.display === 'none';
    const shortcutsHidden = !shortcutsSec || shortcutsSec.style.display === 'none';
    const reqHidden = !reqSec || reqSec.style.display === 'none';
    const userGuideHidden = !userGuideSec || userGuideSec.style.display === 'none';
    return spinnerVisible && loginHidden && guideHidden && shortcutsHidden && reqHidden && userGuideHidden;
  }

  async function restoreRememberedFormFields() {
    const cfg = await Storage.getApiConfig();
    const cred = await Storage.getCredentials();
    const baseUrlInput = $('#baseUrl');
    if (baseUrlInput) baseUrlInput.value = cfg.baseUrl;
    const usernameInput = $('#username');
    if (usernameInput && cred.username && !cred.username.startsWith('(')) {
      usernameInput.value = cred.username;
    }
  }

  async function persistBaseUrlFromInput() {
    const baseUrlInput = $('#baseUrl');
    if (!baseUrlInput) return;
    const baseUrl = baseUrlInput.value.trim();
    if (!baseUrl) return;
    await Storage.saveBaseUrl(baseUrl);
  }

  /**
   * Popup 启动：看门狗 + storage/消息超时，确保 spinner 不会永久卡住。
   * 历史 bug：catch 中 await restoreRememberedFormFields() 会阻塞 finally，
   * 一旦 chrome.storage 挂起，UI 永远停在「正在检查登录状态...」。
   */
  async function init() {
    const watchdog = (typeof startWatchdog === 'function')
      ? startWatchdog(STATE_CHECK_TIMEOUT + 800, () => {
        console.error('[TaskPlugin] init watchdog: 强制结束加载态');
        if (isStillShowingLoadingOnly()) {
          showLoginUI('登录状态检查超时，请重试');
        }
        hideLoadingUI();
      })
      : { cancel() { return false; } };

    try {
      // 打开 popup 即表示用户已看到错误，重置角标
      try { chrome.runtime.sendMessage({ action: 'resetBadge' }); } catch (_) { /* ignore */ }
      bindEvents();

      // 先恢复上次服务器地址/账号（带超时，失败不阻塞）
      try {
        await withTimeout(restoreRememberedFormFields(), STORAGE_READ_TIMEOUT, '恢复表单字段');
      } catch (e) {
        console.warn('[TaskPlugin] 恢复表单字段失败:', e.message || e);
      }

      // 5 秒后如果 spinner 还在，显示重试按钮
      initRetryTimer = setTimeout(() => {
        const spinner = $('#loadingSpinner');
        const retryBtn = $('#btnRetryInit');
        if (spinner && spinner.style.display !== 'none' && retryBtn) {
          retryBtn.style.display = 'inline-block';
        }
      }, STATE_CHECK_TIMEOUT);

      try {
        await withTimeout(loadState(), STATE_CHECK_TIMEOUT, '登录状态检查');
      } catch (e) {
        console.error('[TaskPlugin] loadState 失败:', e);
        showLoginUI(e.message || undefined);
        // 禁止在 finally 前 await storage —— 会阻塞 hideLoadingUI
      }
    } catch (e) {
      console.error('[TaskPlugin] init 失败:', e);
      showLoginUI(e.message || undefined);
    } finally {
      watchdog.cancel();
      hideLoadingUI();
    }

    // finally 之后再尽力恢复表单，失败忽略
    restoreRememberedFormFields().catch(() => {});
  }

  function mountPopupUserGuide() {
    const host = $('#popup-user-guide');
    const section = $('#popupGuideSection');
    if (!host) return;
    if (typeof UserGuide === 'undefined') {
      console.warn('[taskChromePlugin] UserGuide 未加载，弹窗使用说明跳过');
      return;
    }
    UserGuide.mount(host, UserGuide.renderCollapsibleHtml({ surface: 'popup', open: false }));
    if (section) section.style.display = 'block';
  }

  function setPopupGuideVisible(visible) {
    const section = $('#popupGuideSection');
    if (section) section.style.display = visible ? 'block' : 'none';
  }

  async function retryInit() {
    const spinner = $('#loadingSpinner');
    const retryBtn = $('#btnRetryInit');
    const loginSec = $('#loginSection');
    const devGuide = $('#devtoolsGuide');
    const shortcutsSec = $('#shortcutsSection');
    const reqSec = $('#requestsSection');
    if (spinner) spinner.style.display = 'flex';
    if (retryBtn) retryBtn.style.display = 'none';
    if (loginSec) loginSec.style.display = 'none';
    if (devGuide) devGuide.style.display = 'none';
    if (shortcutsSec) shortcutsSec.style.display = 'none';
    if (reqSec) reqSec.style.display = 'none';
    setPopupGuideVisible(false);

    await init();
  }

  function showLoginUI(errorMessage) {
    const status = $('#popupStatus');
    const headerArea = $('#headerUserArea');
    const loginSec = $('#loginSection');
    const devGuide = $('#devtoolsGuide');
    const shortcutsSec = $('#shortcutsSection');
    const reqSec = $('#requestsSection');
    const loginHint = $('#loginHint');
    const loginResult = $('#loginResult');

    if (status) { status.style.display = 'inline'; status.textContent = '⚠️ 未登录'; status.className = 'badge badge-disconnected'; }
    if (headerArea) headerArea.style.display = 'none';
    if (loginSec) loginSec.style.display = 'block';
    if (devGuide) devGuide.style.display = 'none';
    if (shortcutsSec) shortcutsSec.style.display = 'block';
    if (reqSec) reqSec.style.display = 'none';
    setPopupGuideVisible(true);
    mountPopupUserGuide();

    // 显示错误信息或默认提示
    if (loginHint) {
      if (errorMessage) {
        loginHint.textContent = errorMessage;
        loginHint.style.color = '#f38ba8';
      } else {
        loginHint.textContent = '输入 task2app 账号与访问令牌（在账号中心 → 访问令牌 中生成）。';
        loginHint.style.color = '';
      }
    }
    if (loginResult) { loginResult.className = 'result'; loginResult.textContent = ''; }
  }

  /**
   * 显示 token 过期警告
   */
  async function showTokenExpiredUI(username) {
    // 先显示已登录 UI，再显示过期警告横幅
    showLoggedInUI(username);
    const status = $('#popupStatus');
    if (status) { status.style.display = 'inline'; status.textContent = '⚠️ 会话已过期'; status.className = 'badge badge-disconnected'; }

    // 显示重新登录按钮
    const loginSec = $('#loginSection');
    const devGuide = $('#devtoolsGuide');
    const shortcutsSec = $('#shortcutsSection');
    const reqSec = $('#requestsSection');
    if (loginSec) loginSec.style.display = 'block';
    if (devGuide) devGuide.style.display = 'none';
    if (shortcutsSec) shortcutsSec.style.display = 'block';
    if (reqSec) reqSec.style.display = 'none';
    setPopupGuideVisible(true);
    mountPopupUserGuide();

    const loginHint = $('#loginHint');
    if (loginHint) {
      loginHint.textContent = '⏰ 登录会话已过期，请重新登录。';
      loginHint.style.color = '#fab387';
    }

    const btn = $('#btnLogin');
    if (btn) {
      btn.textContent = '🔄 重新登录';
      btn.disabled = false;
    }
  }

  function showLoggedInUI(username) {
    const status = $('#popupStatus');
    const headerArea = $('#headerUserArea');
    const headerUser = $('#headerUser');
    const loginSec = $('#loginSection');
    const devGuide = $('#devtoolsGuide');
    const shortcutsSec = $('#shortcutsSection');
    const reqSec = $('#requestsSection');
    if (status) status.style.display = 'none';
    if (headerArea) headerArea.style.display = 'flex';
    if (headerUser) headerUser.textContent = '👤 ' + (username || '(已登录)');
    if (loginSec) loginSec.style.display = 'none';
    if (devGuide) devGuide.style.display = 'block';
    if (shortcutsSec) shortcutsSec.style.display = 'block';
    if (reqSec) reqSec.style.display = 'block';
    setPopupGuideVisible(true);
    mountPopupUserGuide();

    // 加载多账号列表（异步，不阻塞 UI）
    loadSavedAccounts().catch(() => {});
  }

  // ---- 多账号列表 ----

  async function loadSavedAccounts() {
    let accounts = [];
    let activeUserId = null;
    try {
      const r = await sendMessageWithTimeout({ action: 'getSavedAccounts' }, 5000);
      if (r?.success && Array.isArray(r.data)) {
        accounts = r.data;
      }
      const a = await sendMessageWithTimeout({ action: 'getActiveAccount' }, 5000);
      if (a?.success && a.data) {
        activeUserId = a.data.userId;
      }
    } catch (e) {
      console.warn('[TaskPlugin] 加载多账号列表失败:', e.message || e);
      return;
    }

    renderAccountList(accounts, activeUserId);
  }

  function renderAccountList(accounts, activeUserId) {
    const section = $('#accountsSection');
    const list = $('#savedAccountsList');
    const count = $('#accountCount');
    if (!section || !list) return;

    if (!accounts || accounts.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    if (count) count.textContent = `(${accounts.length})`;

    let html = '';
    for (const acct of accounts) {
      const isActive = acct.userId === activeUserId;
      const avatar = acct.avatarUrl
        ? `<img src="${escHtml(acct.avatarUrl)}" class="acct-avatar" alt="" onerror="this.style.display='none'">`
        : '<span class="acct-avatar-placeholder">👤</span>';
      const name = escHtml(acct.username || acct.userId || '(未知)');
      const activeBadge = isActive ? '<span class="acct-active-badge">✓ 当前</span>' : '';

      html += `<div class="account-item${isActive ? ' active' : ''}">
        ${avatar}
        <span class="acct-name">${name}</span>
        ${activeBadge}
      </div>`;
    }
    list.innerHTML = html;
  }

  async function loadStateFromStorage() {
    const cfg = await Storage.getApiConfig();
    const cred = await Storage.getCredentials();
    const isExpired = cfg.token ? await Storage.isTokenExpired() : false;
    const remaining = await Storage.getTokenRemainingSeconds();
    const expiryHint = Storage.formatTokenExpiryHint(remaining);
    return { cfg, cred, isExpired, expiryHint };
  }

  async function loadState() {
    // 与悬浮面板同源：经 SW 读取并执行过期字段迁移
    let cfg;
    let cred;
    let isExpired = false;
    let expiryHint = null;
    try {
      // 留出余量给 storage 回退，避免与外层 STATE_CHECK_TIMEOUT 叠满
      const r = await sendMessageWithTimeout({ action: 'getAuthStatus' }, Math.max(1500, STATE_CHECK_TIMEOUT - STORAGE_READ_TIMEOUT));
      if (r?.success && r.data) {
        cfg = {
          baseUrl: r.data.baseUrl,
          token: r.data.token || '',
          tokenExpiresAt: r.data.tokenExpiresAt || 0,
          tokenIssuedAt: r.data.tokenIssuedAt || 0,
        };
        cred = {
          username: r.data.username || '',
          userId: r.data.userId || '',
          memberId: r.data.memberId || '',
        };
        isExpired = !!r.data.expired;
        expiryHint = r.data.expiryHint || Storage.formatTokenExpiryHint(r.data.remainingSeconds);
      }
    } catch (e) {
      console.warn('[TaskPlugin] getAuthStatus 失败，回退 Storage:', e.message || e);
    }

    if (!cfg) {
      const local = await withTimeout(loadStateFromStorage(), STORAGE_READ_TIMEOUT, '读取本地登录态');
      cfg = local.cfg;
      cred = local.cred;
      isExpired = local.isExpired;
      expiryHint = local.expiryHint;
    }

    const baseUrl = cfg.baseUrl;

    const baseUrlInput = $('#baseUrl');
    if (baseUrlInput) baseUrlInput.value = baseUrl;

    const usernameInput = $('#username');
    if (usernameInput && cred.username && !cred.username.startsWith('(')) {
      usernameInput.value = cred.username;
    }

    if (cfg.token) {
      if (isExpired) {
        showTokenExpiredUI(cred.username);
        return;
      }

      // 立即显示已登录 UI（不等待子模块）
      showLoggedInUI(cred.username);
      applyExpiryHintToPopup(expiryHint);
      startAuthBadgeTimer();

      // 子模块异步延迟加载 — 不阻塞登录状态检查
      loadSubModules();
    } else {
      stopAuthBadgeTimer();
      showLoginUI();
    }
  }

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
    status.title = '登录会话即将过期，请尽快重新登录';
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
    authBadgeTimer = setInterval(() => {
      refreshAuthBadgeOnly();
    }, AUTH_BADGE_REFRESH_MS);
  }

  function stopAuthBadgeTimer() {
    if (authBadgeTimer) {
      clearInterval(authBadgeTimer);
      authBadgeTimer = null;
    }
  }

  /**
   * 延迟加载子模块（悬浮球配置、跟踪配置、请求列表）
   * 不阻塞登录状态检查，失败静默忽略
   */
  async function loadSubModules() {
    try {
      const results = await Promise.allSettled([
        loadFloatBallConfig(),
        loadTrackingConfig(),
        loadSyncDescriptionConfig(),
        loadCapturedRequests(),
      ]);
      for (const r of results) {
        if (r.status === 'rejected') {
          console.warn('[TaskPlugin] loadState 子模块加载失败:', r.reason);
        }
      }
    } catch (_) { /* ignore */ }
  }

  async function loadFloatBallConfig() {
    try {
      const cfg = await Storage.getFloatBallConfig();
      const toggle = $('#floatBallToggle');
      if (toggle) toggle.checked = cfg.enabled;
    } catch (_) { /* ignore */ }
  }

  async function loadTrackingConfig() {
    try {
      const r = await sendMessageWithTimeout({ action: 'getTrackingConfig' }, 5000);
      if (r?.success) {
        const toggle = $('#trackingToggle');
        if (toggle) toggle.checked = r.data?.enabled || false;
      }
    } catch (e) {
      console.warn('[TaskPlugin] loadTrackingConfig 失败:', e.message);
    }
  }

  async function loadSyncDescriptionConfig() {
    try {
      const r = await sendMessageWithTimeout({ action: 'getSyncDescriptionConfig' }, 5000);
      if (r?.success) {
        const toggle = $('#syncDescriptionToggle');
        if (toggle) toggle.checked = r.data?.enabled !== false;
      }
    } catch (e) {
      console.warn('[TaskPlugin] loadSyncDescriptionConfig 失败:', e.message);
    }
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    // 登录按钮 — 账号 + 访问令牌
    const btnLogin = $('#btnLogin');
    if (btnLogin) btnLogin.addEventListener('click', handleTokenLogin);

    // 退出登录
    const btnLogout = $('#btnLogout');
    if (btnLogout) btnLogout.addEventListener('click', handleLogout);

    // 服务器地址：失焦/变更时自动保留上次输入
    const baseUrlInput = $('#baseUrl');
    if (baseUrlInput) {
      baseUrlInput.addEventListener('change', () => { persistBaseUrlFromInput().catch(() => {}); });
      baseUrlInput.addEventListener('blur', () => { persistBaseUrlFromInput().catch(() => {}); });
    }

    // 重试初始化
    const btnRetry = $('#btnRetryInit');
    if (btnRetry) btnRetry.addEventListener('click', retryInit);

    // 悬浮球开关
    const floatToggle = $('#floatBallToggle');
    if (floatToggle) {
      floatToggle.addEventListener('change', async () => {
        const enabled = floatToggle.checked;
        try {
          await withTimeout(Storage.saveFloatBallConfig(enabled), STORAGE_READ_TIMEOUT, '保存悬浮球配置');
        } catch (_) { /* ignore */ }
        try {
          const tabs = await chrome.tabs.query({});
          for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, { action: 'setFloatBallEnabled', enabled }).catch(() => {});
          }
        } catch (_) { /* ignore */ }
      });
    }

    // 跟踪开关
    const trackingToggle = $('#trackingToggle');
    if (trackingToggle) {
      trackingToggle.addEventListener('change', async () => {
        const enabled = trackingToggle.checked;
        try {
          await sendMessageWithTimeout({ action: 'setTrackingConfig', enabled }, 5000);
        } catch (_) { /* ignore */ }
      });
    }

    // 跨页面同步任务描述开关
    const syncDescToggle = $('#syncDescriptionToggle');
    if (syncDescToggle) {
      syncDescToggle.addEventListener('change', async () => {
        const enabled = syncDescToggle.checked;
        try {
          await sendMessageWithTimeout({ action: 'setSyncDescriptionConfig', enabled }, 5000);
        } catch (_) { /* ignore */ }
        try {
          const tabs = await chrome.tabs.query({});
          for (const tab of tabs) {
            if (!tab.id) continue;
            chrome.tabs.sendMessage(tab.id, { action: 'setSyncDescriptionEnabled', enabled }).catch(() => {});
          }
        } catch (_) { /* ignore */ }
      });
    }

    // 请求列表
    const btnToggleReqs = $('#btnToggleRequests');
    if (btnToggleReqs) {
      btnToggleReqs.addEventListener('click', () => {
        const body = $('#requestsBody'); const btn = btnToggleReqs;
        if (!body) return;
        if (body.style.display === 'none') { body.style.display = 'block'; btn.textContent = '收起'; }
        else { body.style.display = 'none'; btn.textContent = '展开'; }
      });
    }
    const btnRefreshReqs = $('#btnRefreshReqs');
    if (btnRefreshReqs) btnRefreshReqs.addEventListener('click', loadCapturedRequests);
    const btnClearReqs = $('#btnClearReqs');
    if (btnClearReqs) btnClearReqs.addEventListener('click', clearCapturedRequests);
    const reqSearch = $('#reqSearch');
    if (reqSearch) reqSearch.addEventListener('input', renderRequestList);
    const reqStatusFilter = $('#reqStatusFilter');
    if (reqStatusFilter) reqStatusFilter.addEventListener('change', renderRequestList);
  }

  // ---- 账号 + 令牌登录 ----

  function isAccessTokenFormat(token) {
    return typeof token === 'string' && token.startsWith('at_') && token.length >= 12;
  }

  function notifyContentScriptsAuthChanged() {
    chrome.tabs.query({}).then((tabs) => {
      for (const tab of tabs) {
        if (!tab.id) continue;
        chrome.tabs.sendMessage(tab.id, { action: 'authStateChanged' }).catch(() => {});
      }
    }).catch(() => {});
  }

  async function handleTokenLogin() {
    const baseUrlInput = $('#baseUrl');
    const usernameInput = $('#username');
    const accessTokenInput = $('#accessToken');
    const baseUrl = baseUrlInput ? baseUrlInput.value.trim() : '';
    const username = usernameInput ? usernameInput.value.trim() : '';
    const accessToken = accessTokenInput ? accessTokenInput.value.trim() : '';
    if (!baseUrl) return showResult('loginResult', '请填写服务器地址', 'error');
    if (!username) return showResult('loginResult', '请填写账号', 'error');
    if (!accessToken) return showResult('loginResult', '请填写访问令牌', 'error');
    if (!isAccessTokenFormat(accessToken)) {
      return showResult('loginResult', '访问令牌格式无效，应以 at_ 开头', 'error');
    }

    const btn = $('#btnLogin');
    const loginResult = $('#loginResult');
    if (!btn) return;

    if (loginResult) { loginResult.className = 'result'; loginResult.textContent = ''; }

    btn.disabled = true;
    btn.textContent = '⏳ 登录中...';

    // 保存地址不得阻塞登录：chrome.storage 挂起时历史上会导致点击无响应
    try {
      await withTimeout(Storage.saveBaseUrl(baseUrl), STORAGE_READ_TIMEOUT, '保存服务器地址');
    } catch (e) {
      console.warn('[TaskPlugin] 保存服务器地址失败（继续登录）:', e.message || e);
    }

    try {
      const res = await sendMessageWithTimeout({
        action: 'loginWithAccessToken',
        baseUrl,
        username,
        accessToken,
      }, 30000);

      if (res?.success) {
        // 先切已登录 UI，再刷新态：避免 storage/广播竞态让用户误以为「卡在登录页」
        const displayName = username
          || res.data?.user?.username
          || res.data?.user?.email
          || '';
        showLoggedInUI(displayName);
        startAuthBadgeTimer();
        notifyContentScriptsAuthChanged();
        try {
          await withTimeout(loadState(), STATE_CHECK_TIMEOUT, '刷新登录态');
          // loadState 若因 storage 延迟回到登录表单，保持乐观已登录
          if ($('#loginSection')?.style.display !== 'none' && (res.data?.token || res.data?.access_token)) {
            showLoggedInUI(displayName);
            startAuthBadgeTimer();
          }
        } catch (e) {
          console.warn('[TaskPlugin] 登录后刷新态失败，保持已登录展示:', e.message || e);
          showLoggedInUI(displayName);
          startAuthBadgeTimer();
        }
      } else {
        showResult('loginResult', `❌ ${res?.error || '登录失败'}`, 'error', res?.traceId);
      }
    } catch (e) {
      showResult('loginResult', `❌ ${e.message || '登录失败'}`, 'error', e.traceId);
    } finally {
      btn.disabled = false;
      if ($('#loginSection')?.style.display !== 'none') {
        btn.textContent = '🔓 登录';
      }
    }
  }

  // ---- 登出 ----

  async function handleLogout() {
    stopAuthBadgeTimer();
    try {
      await sendMessageWithTimeout({ action: 'logout' }, 5000);
    } catch (e) {
      console.warn('[TaskPlugin] SW logout 失败，回退本地 clearAuth:', e.message || e);
      try {
        await withTimeout(Storage.clearAuth(), STORAGE_READ_TIMEOUT, '清除登录态');
      } catch (_) { /* ignore */ }
    }
    notifyContentScriptsAuthChanged();
    try {
      await withTimeout(loadState(), STATE_CHECK_TIMEOUT, '刷新登录态');
    } catch (_) {
      showLoginUI();
    }
  }

  // ---- 请求列表 ----

  async function loadCapturedRequests() {
    try {
      const r = await sendMessageWithTimeout({ action: 'getCapturedErrors' }, 5000);
      capturedRequests = r?.success ? (r.data || []) : [];
    } catch (e) {
      console.warn('[TaskPlugin] loadCapturedRequests 失败:', e.message);
      capturedRequests = [];
    }
    renderRequestList();
  }

  async function clearCapturedRequests() {
    try {
      await sendMessageWithTimeout({ action: 'clearCapturedErrors' }, 5000);
    } catch (e) {
      console.warn('[TaskPlugin] clearCapturedRequests 失败:', e.message);
    }
    capturedRequests = [];
    selectedReqId = null;
    renderRequestList();
    const detail = $('#popupReqDetail');
    if (detail) detail.style.display = 'none';
  }

  function isRequestCanceled(req) {
    return !!(req?.canceled || req?.statusCode === 0);
  }

  function formatRequestStatusLabel(req) {
    if (isRequestCanceled(req)) return 'Canceled';
    return String(req?.statusCode ?? '');
  }

  function renderRequestList() {
    const search = ($('#reqSearch').value || '').toLowerCase();
    const statusFilter = $('#reqStatusFilter').value;

    let filtered = capturedRequests.filter(r => {
      if (search) {
        const url = (r.url || '').toLowerCase();
        const m = (r.method || '').toLowerCase();
        const sc = String(r.statusCode || '');
        const canceledLabel = isRequestCanceled(r) ? 'canceled' : '';
        if (!url.includes(search) && !m.includes(search) && !sc.includes(search) && !canceledLabel.includes(search)) return false;
      }
      if (statusFilter === 'canceled' && !isRequestCanceled(r)) return false;
      if (statusFilter === '5xx' && !(r.statusCode >= 500 && r.statusCode < 600)) return false;
      if (statusFilter === '4xx' && !(r.statusCode >= 400 && r.statusCode < 500)) return false;
      if (statusFilter === '2xx' && !(r.statusCode >= 200 && r.statusCode < 300)) return false;
      if (statusFilter === '3xx' && !(r.statusCode >= 300 && r.statusCode < 400)) return false;
      return true;
    });

    filtered.sort((a, b) => (b.capturedAt || b.timeStamp || 0) - (a.capturedAt || a.timeStamp || 0));
    const display = filtered.slice(0, 50);
    $('#requestCountBadge').textContent = `(${filtered.length} 条)`;

    const container = $('#requestList');
    if (display.length === 0) {
      container.innerHTML = '<p class="placeholder">暂无匹配的请求</p>';
      return;
    }

    let html = '';
    for (const req of display) {
      const scCls = isRequestCanceled(req) ? 'err-4xx' : (req.statusCode >= 500 ? 'err-5xx' : (req.statusCode >= 400 ? 'err-4xx' : 'err-ok'));
      const sel = selectedReqId === req.id ? ' selected' : '';
      const urlShort = (req.url || '').length > 60 ? req.url.slice(0, 60) + '…' : (req.url || '');
      html += `<div class="popup-req-item${sel}" data-id="${req.id}">
        <span class="req-method ${req.method}">${req.method}</span>
        <span class="req-status ${scCls}">${formatRequestStatusLabel(req)}</span>
        <span class="req-url">${escHtml(urlShort)}</span>
      </div>`;
    }
    container.innerHTML = html;

    container.querySelectorAll('.popup-req-item').forEach(el => {
      el.addEventListener('click', () => {
        const req = capturedRequests.find(x => x.id === el.dataset.id);
        if (req) selectRequest(req);
      });
    });
  }

  function selectRequest(req) {
    selectedReqId = req.id;
    document.querySelectorAll('.popup-req-item').forEach(x => x.classList.remove('selected'));
    const tgt = document.querySelector(`.popup-req-item[data-id="${req.id}"]`);
    if (tgt) tgt.classList.add('selected');

    const el = $('#popupReqDetail');
    if (!el) return;
    el.style.display = 'block';

    let reqHdrHtml = '';
    if (req.requestHeaders && Object.keys(req.requestHeaders).length) {
      reqHdrHtml = '<div class="detail-section"><h4>📤 请求头</h4>' +
        Object.entries(req.requestHeaders).map(([k, v]) =>
          `<span class="hdr-pair"><strong>${escHtml(k)}:</strong> ${escHtml(String(v))}</span>`
        ).join('<br>') + '</div>';
    }

    let resHdrHtml = '';
    if (req.responseHeaders && Object.keys(req.responseHeaders).length) {
      resHdrHtml = '<div class="detail-section"><h4>📥 响应头</h4>' +
        Object.entries(req.responseHeaders).map(([k, v]) =>
          `<span class="hdr-pair"><strong>${escHtml(k)}:</strong> ${escHtml(String(v))}</span>`
        ).join('<br>') + '</div>';
    }

    el.innerHTML = `<div style="margin-bottom:6px">
      <span class="req-method ${req.method}">${req.method}</span>
      <span class="req-status ${isRequestCanceled(req) ? 'err-4xx' : (req.statusCode >= 400 ? 'err-4xx' : 'err-ok')}">${formatRequestStatusLabel(req)}</span>
      <span style="font-size:10px;color:#6c7086;margin-left:6px">${escHtml(req.url)}</span>
    </div>
    ${reqHdrHtml}
    ${req.requestBody ? `<div class="detail-section"><h4>📤 请求体</h4><pre class="body-pre">${escHtml(String(req.requestBody))}</pre></div>` : ''}
    ${resHdrHtml}
    ${req.responseBody ? `<div class="detail-section"><h4>📥 响应体</h4><pre class="body-pre">${escHtml(String(req.responseBody))}</pre></div>` : ''}
    <div class="dt-hint" style="margin-top:8px;padding:6px 8px;background:#252536;border-radius:4px;text-align:center">
      <span style="font-size:10px;color:#89b4fa;">💡 按 <kbd style="background:#45475a;color:#cdd6f4;padding:1px 5px;border-radius:3px;font-size:9px">F12</kbd> → <b>TaskPlugin</b> 面板创建任务</span>
    </div>`;
  }

  // ---- Utility ----
  function escHtml(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  function showResult(targetId, msg, type, traceId) {
    const el = $(`#${targetId}`);
    if (!el) return;
    el.textContent = msg;
    el.className = `result ${type}`;
    if (type === 'error') {
      setDataTraceId(el, traceId);
    } else {
      setDataTraceId(el, '');
    }
    setTimeout(() => {
      el.className = 'result';
      el.removeAttribute('data-traceId');
    }, 8000);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  // 快捷键排查入口：chrome:// 页面无法直接 <a href>，需经 tabs.create 打开
  document.getElementById('taskplugin-shortcut-settings')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => {});
  });

  Popup.init().catch((e) => {
    console.error('[TaskPlugin] Popup.init 未捕获异常:', e);
    const spinner = document.querySelector('#loadingSpinner');
    if (spinner) spinner.style.display = 'none';
    const loginSec = document.querySelector('#loginSection');
    if (loginSec) loginSec.style.display = 'block';
    const status = document.querySelector('#popupStatus');
    if (status) {
      status.style.display = 'inline';
      status.textContent = '⚠️ 未登录';
      status.className = 'badge badge-disconnected';
    }
  });
});
