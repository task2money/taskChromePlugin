/**
 * Popup 脚本 — 账号+令牌登录、连接状态、请求快速预览
 * 任务创建请使用 DevTools Panel (F12 → 云端Coding: 自动创新助手)
 * Classic scripts share var/function; popup.js must load last (OPT-20260821-004).
 */

  var $ = (sel) => document.querySelector(sel);

  var capturedRequests = [];
  var selectedReqId = null;
  var authBadgeTimer = null;
  var AUTH_BADGE_REFRESH_MS = 60 * 1000;

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

  var initRetryTimer = null;
  var eventsBound = false;
  var STATE_CHECK_TIMEOUT = 5000; // 登录状态检查最长 5 秒
  var STORAGE_READ_TIMEOUT = 2000; // storage 读取最长 2 秒

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
    const floatSec = $('#floatBallSection');
    const reqSec = $('#requestsSection');
    const userGuideSec = $('#popupGuideSection');
    const spinnerVisible = spinner && spinner.style.display !== 'none';
    const loginHidden = !loginSec || loginSec.style.display === 'none';
    const guideHidden = !devGuide || devGuide.style.display === 'none';
    const shortcutsHidden = !shortcutsSec || shortcutsSec.style.display === 'none';
    const floatHidden = !floatSec || floatSec.style.display === 'none';
    const reqHidden = !reqSec || reqSec.style.display === 'none';
    const userGuideHidden = !userGuideSec || userGuideSec.style.display === 'none';
    return spinnerVisible && loginHidden && guideHidden && shortcutsHidden && floatHidden && reqHidden && userGuideHidden;
  }

  async function restoreRememberedFormFields() {
    const cfg = await Storage.getApiConfig();
    const baseUrlInput = $('#baseUrl');
    if (baseUrlInput) baseUrlInput.value = cfg.baseUrl;
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

    // finally 之后再尽力恢复表单/快捷键配置，失败忽略
    restoreRememberedFormFields().catch(() => {});
    loadPickShortcutConfig();
  }

  async function mountPopupUserGuide() {
    const host = $('#popup-user-guide');
    const section = $('#popupGuideSection');
    if (!host) return;
    if (typeof UserGuide === 'undefined') {
      console.warn('[taskChromePlugin] UserGuide 未加载，弹窗使用说明跳过');
      return;
    }
    // 快捷键说明动态插值用户当前选择的组合（OPT-20260806-017）
    await UserGuide.loadShortcutModeFromStorage().catch(() => {});
    UserGuide.mount(host, UserGuide.renderCollapsibleHtml({ surface: 'popup', open: false }));
    if (section) section.style.display = 'block';
  }

  function setPopupGuideVisible(visible) {
    const section = $('#popupGuideSection');
    if (section) section.style.display = visible ? 'block' : 'none';
  }

  function setFloatBallSectionVisible(visible) {
    const section = $('#floatBallSection');
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
    setFloatBallSectionVisible(false);
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
    setFloatBallSectionVisible(true);
    loadFloatBallConfig();
    setPopupGuideVisible(true);
    mountPopupUserGuide();

    // 显示错误信息或默认提示
    if (loginHint) {
      if (errorMessage) {
        loginHint.textContent = errorMessage;
        loginHint.style.color = '#f38ba8';
      } else {
        loginHint.textContent = '通过网页端授权登录（OAuth2+PKCE）。';
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
    setFloatBallSectionVisible(true);
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
    setFloatBallSectionVisible(true);
    setPopupGuideVisible(true);
    mountPopupUserGuide();
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

  /**
   * 延迟加载子模块（悬浮球配置、跟踪配置、请求列表）
   * 不阻塞登录状态检查，失败静默忽略
   */
  async function loadSubModules() {
    try {
      const results = await Promise.allSettled([
        loadFloatBallConfig(),
        loadTrackingConfig(),
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
