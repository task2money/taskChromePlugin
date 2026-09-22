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
        new Promise((_, reject) => setTimeout(() => reject(new Error(tx('opTimeout', { label: label || tx('commonOp') }))), ms)),
      ]);

    try {
      return race(
        chrome.runtime.sendMessage(action),
        timeoutMs,
        tx('opMessageLabel', { action: action.action || action }),
      );
    } catch (syncErr) {
      return Promise.reject(syncErr);
    }
  }

  var initRetryTimer = null;
  var eventsBound = false;
  var STATE_CHECK_TIMEOUT = 5000; // 登录状态检查最长 5 秒
  var STORAGE_READ_TIMEOUT = 2000; // storage 读取最长 2 秒

  function renderPopupVersion() {
    const el = $('#popupVersion');
    const api = globalThis.PluginVersion;
    if (!api || typeof api.applyExtensionVersionToElement !== 'function') return;
    api.applyExtensionVersionToElement(
      el,
      typeof chrome !== 'undefined' ? chrome : undefined,
      tx,
    );
  }

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
    const loginToggle = $('#btnToggleLogin');
    const devGuide = $('#devtoolsGuide');
    const shortcutsSec = $('#shortcutsSection');
    const floatSec = $('#floatBallSection');
    const reqSec = $('#requestsSection');
    const userGuideSec = $('#popupGuideSection');
    const spinnerVisible = spinner && spinner.style.display !== 'none';
    const loginHidden = !loginSec || loginSec.style.display === 'none';
    const loginToggleHidden = !loginToggle || loginToggle.style.display === 'none';
    const guideHidden = !devGuide || devGuide.style.display === 'none';
    const shortcutsHidden = !shortcutsSec || shortcutsSec.style.display === 'none';
    const floatHidden = !floatSec || floatSec.style.display === 'none';
    const reqHidden = !reqSec || reqSec.style.display === 'none';
    const userGuideHidden = !userGuideSec || userGuideSec.style.display === 'none';
    return spinnerVisible && loginHidden && loginToggleHidden && guideHidden && shortcutsHidden && floatHidden && reqHidden && userGuideHidden;
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
    try {
      if (globalThis.AidevpushI18n) {
        await globalThis.AidevpushI18n.hydrateFromStorage();
        globalThis.AidevpushI18n.applyDom(document);
        const loc = globalThis.AidevpushI18n.getLocale();
        document.documentElement.lang = loc === 'en' ? 'en' : 'zh-CN';
      }
    } catch (_) { /* ignore */ }
    renderPopupVersion();

    const watchdog = (typeof startWatchdog === 'function')
      ? startWatchdog(STATE_CHECK_TIMEOUT + 800, () => {
        console.error('[TaskPlugin] init watchdog: 强制结束加载态');
        if (isStillShowingLoadingOnly()) {
          showLoginUI(tx('popupAuthCheckTimeout'));
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
        await withTimeout(restoreRememberedFormFields(), STORAGE_READ_TIMEOUT, tx('opRestoreFormFields'));
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
        await withTimeout(loadState(), STATE_CHECK_TIMEOUT, tx('opAuthStateCheck'));
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

  function setLoginToggleVisible(visible) {
    const btn = $('#btnToggleLogin');
    if (!btn) return;
    btn.style.display = visible ? 'inline-block' : 'none';
    if (!visible) {
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = tx('login');
    }
  }

  function setLoginFormExpanded(expanded) {
    const loginSec = $('#loginSection');
    const btn = $('#btnToggleLogin');
    if (loginSec) loginSec.style.display = expanded ? 'block' : 'none';
    if (btn) {
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      btn.textContent = expanded ? tx('commonCollapse') : tx('login');
    }
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
    setLoginToggleVisible(false);
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
    const devGuide = $('#devtoolsGuide');
    const shortcutsSec = $('#shortcutsSection');
    const reqSec = $('#requestsSection');
    const loginHint = $('#loginHint');
    const loginResult = $('#loginResult');

    if (status) { status.style.display = 'inline'; status.textContent = tx('panelBadgeNotLoggedIn'); status.className = 'badge badge-disconnected'; }
    if (headerArea) headerArea.style.display = 'none';
    setLoginToggleVisible(true);
    setLoginFormExpanded(!!errorMessage);
    if (devGuide) devGuide.style.display = 'none';
    if (shortcutsSec) shortcutsSec.style.display = 'block';
    if (reqSec) reqSec.style.display = 'none';
    setFloatBallSectionVisible(true);
    loadFloatBallConfig();
    if (window.PopupPageAdvisorLlm?.setLlmSectionVisible) {
      window.PopupPageAdvisorLlm.setLlmSectionVisible(true);
    }
    if (window.PopupPageAdvisorLlm?.loadPageAdvisorLlmConfig) {
      window.PopupPageAdvisorLlm.loadPageAdvisorLlmConfig();
    }
    if (window.PopupPageAdvisorSkills?.setSkillSectionVisible) {
      window.PopupPageAdvisorSkills.setSkillSectionVisible(true);
    }
    if (window.PopupPageAdvisorSkills?.loadSkills) {
      window.PopupPageAdvisorSkills.loadSkills();
    }
    setPopupGuideVisible(true);
    mountPopupUserGuide();

    // 显示错误信息或默认提示
    if (loginHint) {
      if (errorMessage) {
        loginHint.textContent = errorMessage;
        loginHint.style.color = '#f38ba8';
      } else {
        loginHint.textContent = tx('loginHint');
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
    if (status) { status.style.display = 'inline'; status.textContent = tx('popupSessionExpiredBadge'); status.className = 'badge badge-disconnected'; }

    // 显示重新登录按钮
    const devGuide = $('#devtoolsGuide');
    const shortcutsSec = $('#shortcutsSection');
    const reqSec = $('#requestsSection');
    setLoginToggleVisible(true);
    setLoginFormExpanded(true);
    if (devGuide) devGuide.style.display = 'none';
    if (shortcutsSec) shortcutsSec.style.display = 'block';
    if (reqSec) reqSec.style.display = 'none';
    setFloatBallSectionVisible(true);
    setPopupGuideVisible(true);
    mountPopupUserGuide();

    const loginHint = $('#loginHint');
    if (loginHint) {
      loginHint.textContent = tx('popupSessionExpiredHint');
      loginHint.style.color = '#fab387';
    }

    const btn = $('#btnLogin');
    if (btn) {
      btn.textContent = tx('popupReloginBtn');
      btn.disabled = false;
    }
  }

  function showLoggedInUI(username) {
    const status = $('#popupStatus');
    const headerArea = $('#headerUserArea');
    const headerUser = $('#headerUser');
    const devGuide = $('#devtoolsGuide');
    const shortcutsSec = $('#shortcutsSection');
    const reqSec = $('#requestsSection');
    if (status) status.style.display = 'none';
    if (headerArea) headerArea.style.display = 'flex';
    if (headerUser) headerUser.textContent = '👤 ' + (username || tx('popupLoggedInFallback'));
    setLoginToggleVisible(false);
    setLoginFormExpanded(false);
    if (devGuide) devGuide.style.display = 'block';
    if (shortcutsSec) shortcutsSec.style.display = 'block';
    if (reqSec) reqSec.style.display = 'block';
    setFloatBallSectionVisible(true);
    if (window.PopupPageAdvisorLlm?.setLlmSectionVisible) {
      window.PopupPageAdvisorLlm.setLlmSectionVisible(true);
    }
    if (window.PopupPageAdvisorSkills?.setSkillSectionVisible) {
      window.PopupPageAdvisorSkills.setSkillSectionVisible(true);
    }
    setPopupGuideVisible(true);
    mountPopupUserGuide();
  }

  /**
   * 已登录后从账号 preferred_locale 水合，再重挂使用说明（ADR-0089）。
   * 失败不阻断已登录 UI。
   */
  async function refreshPopupLocaleFromProfile() {
    try {
      const r = await sendMessageWithTimeout({ action: 'hydratePreferredLocale' }, 3000);
      const loc = r && r.locale;
      if (loc && globalThis.AidevpushI18n) {
        globalThis.AidevpushI18n.setLocale(loc);
        globalThis.AidevpushI18n.applyDom(document);
        document.documentElement.lang = loc === 'en' ? 'en' : 'zh-CN';
      }
      if (globalThis.PluginLocaleSwitcher) globalThis.PluginLocaleSwitcher.syncSelect();
    } catch (e) {
      console.warn('[TaskPlugin] preferred_locale hydrate skipped:', e.message || e);
    }
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
      const local = await withTimeout(loadStateFromStorage(), STORAGE_READ_TIMEOUT, tx('opReadLocalAuth'));
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
        if (typeof API !== 'undefined' && typeof API.clearSession === 'function') API.clearSession();
        showTokenExpiredUI(cred.username);
        return;
      }

      try {
        const mapping = (typeof Storage !== 'undefined' && Storage.getEndpointMapping)
          ? await Storage.getEndpointMapping()
          : null;
        if (typeof API !== 'undefined' && typeof API.init === 'function') {
          API.init(cfg.baseUrl, cfg.token, mapping, cred.userId || '');
        }
      } catch (_) {
        if (typeof API !== 'undefined' && typeof API.init === 'function') {
          API.init(cfg.baseUrl, cfg.token, null, cred.userId || '');
        }
      }

      // 立即显示已登录 UI（不等待子模块）
      showLoggedInUI(cred.username);
      applyExpiryHintToPopup(expiryHint);
      startAuthBadgeTimer();
      void refreshPopupLocaleFromProfile();

      // 子模块异步延迟加载 — 不阻塞登录状态检查
      loadSubModules();
    } else {
      if (typeof API !== 'undefined' && typeof API.clearSession === 'function') API.clearSession();
      stopAuthBadgeTimer();
      showLoginUI();
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
        window.PopupPageAdvisorLlm?.loadPageAdvisorLlmConfig
          ? window.PopupPageAdvisorLlm.loadPageAdvisorLlmConfig()
          : Promise.resolve(),
        window.PopupPageAdvisorSkills?.loadSkills
          ? window.PopupPageAdvisorSkills.loadSkills()
          : Promise.resolve(),
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
