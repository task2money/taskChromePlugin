/**
 * Panel 核心：共享状态 + DOM 工具 + 认证 + 消息管道。
 * 挂载到 window.PanelApp，供 panel.js 与各 tab 文件共享（OPT-20260812-051 拆分）。
 */
window.PanelApp = (function () {
  // ---- State（各 Tab 共享）----
  const state = {
    apiConfig: { baseUrl: 'https://aidevpush.com', token: '' },
    isLoggedIn: false,
    /** 上一轮 refreshAuthState 的登录态，用于检测「已登录→过期/登出」翻转 */
    wasLoggedIn: false,
    selectedRequest: null,
    recentRequests: [],
    workspaces: [],
    projectsCache: {},
    membersCache: {},   // { companyId: [{id, user_id, member_name, ...}] }
    progressColumnsCache: {},
    currentUserId: '',  // set after login
    currentMemberId: '',  // from login response current_company.member_id
    /** 请求列表是否已完成至少一次引导刷新（用于离开 HTML 初始 loading） */
    requestListBootstrapped: false,
    pendingAidevMatches: null,
    authBadgeTimer: null,
    authBadgeCtl: null,
    gitIdentities: [],
  };

  const AUTH_BADGE_REFRESH_MS = 60 * 1000;

  const Bootstrap = (typeof PanelRequestBootstrap !== 'undefined')
    ? PanelRequestBootstrap
    : null;
  const requestMsgBuffer = Bootstrap
    ? Bootstrap.createRequestMessageBuffer()
    : null;

  const api = {
    state,
    AUTH_BADGE_REFRESH_MS,
    Bootstrap,
    requestMsgBuffer,
  };

  // ---- DOM ----
  api.$ = (sel) => document.querySelector(sel);
  api.$$ = (sel) => document.querySelectorAll(sel);

  api.isRequestCanceled = function (req) {
    return !!(req?.canceled || req?.statusCode === 0);
  };

  api.formatRequestStatusLabel = function (req) {
    if (api.isRequestCanceled(req)) return 'Canceled';
    return String(req?.statusCode ?? '');
  };

  api.getRequestStatusClass = function (req) {
    if (api.isRequestCanceled(req)) return 'canceled';
    if (req?.statusCode >= 400) return 'error';
    return 'ok';
  };

  api.handleRequestMessage = function (data) {
    if (!data?.action) return;
    if (data.action === 'initRequests') {
      state.recentRequests = data.requests || [];
      state.recentRequests.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      api.applyRequestFilters();
    } else if (data.action === 'newRequest') {
      if (!data.request) return;
      state.recentRequests.unshift(data.request);
      if (state.recentRequests.length > 500) state.recentRequests.pop();
      api.applyRequestFilters();
    } else if (data.action === 'requestUpdated') {
      const updated = data.request;
      if (!updated?.id) return;
      const idx = state.recentRequests.findIndex((r) => r.id === updated.id);
      if (idx >= 0) {
        state.recentRequests[idx] = updated;
        if (state.selectedRequest?.id === updated.id) {
          state.selectedRequest = updated;
          api.fillRequestDetail(updated);
        }
        // 状态码/耗时等展示字段可能变化，必须重渲染列表
        api.applyRequestFilters();
      }
    }
  };

  /**
   * 接通 DevTools postMessage 消息管道（initRequests / newRequest / requestUpdated）。
   * 必须在任何 await 之前调用，避免 onShown 的 initRequests 丢失。
   *
   * 注意：window message listener 必须在这里注册（唯一注册点），不能放在
   * panel.html head 内联脚本里 —— MV3 扩展页面默认 CSP (script-src 'self')
   * 会阻止内联脚本，head 内联 relay 被静默丢弃会导致 devtools 请求列表为空。
   * 此处注册时机先于 devtools onShown 的 postMessage（panel 页面脚本同步执行
   * 完成于 panel 可见回调），sink 未就绪时的早到消息落入 __tcpRequestMsgEarly 缓冲。
   */
  api.bindRequestMessagePipeline = function () {
    window.addEventListener('message', (event) => {
      if (!event || event.origin !== window.location.origin) {
        return;
      }
      const d = event.data;
      if (!d || !d.action) return;
      if (d.action !== 'initRequests' && d.action !== 'newRequest' && d.action !== 'requestUpdated') return;
      if (typeof window.__tcpRequestMsgSink === 'function') {
        window.__tcpRequestMsgSink(d);
        return;
      }
      window.__tcpRequestMsgEarly = window.__tcpRequestMsgEarly || [];
      window.__tcpRequestMsgEarly.push(d);
    });
    if (requestMsgBuffer) {
      requestMsgBuffer.setConsumer(api.handleRequestMessage);
      window.__tcpRequestMsgSink = (data) => requestMsgBuffer.push(data);
    } else {
      window.__tcpRequestMsgSink = api.handleRequestMessage;
    }
    const early = Array.isArray(window.__tcpRequestMsgEarly)
      ? window.__tcpRequestMsgEarly.splice(0, window.__tcpRequestMsgEarly.length)
      : [];
    for (const data of early) {
      if (requestMsgBuffer) requestMsgBuffer.push(data);
      else api.handleRequestMessage(data);
    }
  };

  api.mountUserGuide = async function () {
    const host = api.$('#panel-user-guide');
    if (!host) return;
    if (typeof UserGuide === 'undefined') {
      console.warn('[taskChromePlugin] UserGuide 未加载，面板使用说明跳过');
      host.textContent = '使用说明模块未加载';
      return;
    }
    // 快捷键说明动态插值用户当前选择的组合（OPT-20260806-017）
    await UserGuide.loadShortcutModeFromStorage().catch(() => {});
    UserGuide.mount(host, UserGuide.renderFullGuideHtml({ surface: 'panel' }));
  };

  api.loadSavedOwner = async function () {
    // Kept for backward compatibility; members now loaded on workspace change.
  };

  /**
   * 清空 workspace / 项目 / 成员等会话相关缓存，并重置选择器 UI。
   * @param {{ reason?: 'expired'|'logout'|'auth_failure', notify?: boolean }} [opts]
   */
  api.clearWorkspaceAuthCaches = function (opts = {}) {
    const reason = opts.reason || 'expired';
    const notify = opts.notify !== false;

    state.workspaces = [];
    state.projectsCache = {};
    state.membersCache = {};
    state.progressColumnsCache = {};

    const wsHint = reason === 'logout'
      ? '-- 请先登录 --'
      : '-- 会话过期，请重新登录 --';

    for (const id of ['singleWorkspace', 'batchWorkspace']) {
      const sel = api.$(`#${id}`);
      if (sel) sel.innerHTML = `<option value="">${wsHint}</option>`;
    }

    const singleProjects = api.$('#singleProjects');
    if (singleProjects) singleProjects.innerHTML = '<p class="placeholder">请先重新登录</p>';
    const batchProjects = api.$('#batchProjects');
    if (batchProjects) batchProjects.innerHTML = '<p class="placeholder">请先重新登录</p>';

    const ownerSel = api.$('#singleOwner');
    if (ownerSel) ownerSel.innerHTML = '<option value="">请重新登录</option>';
    const progressSel = api.$('#singleProgressColumn');
    if (progressSel) progressSel.innerHTML = '<option value="">请重新登录</option>';
    const deliverableSel = api.$('#singleDeliverable');
    if (deliverableSel) deliverableSel.innerHTML = '<option value="">请重新登录</option>';
    const assignees = api.$('#singleAssignees');
    if (assignees) assignees.innerHTML = '<p class="placeholder">请先重新登录</p>';
    const repoBases = api.$('#singleRepoBases');
    if (repoBases) repoBases.innerHTML = '<p class="placeholder">请先重新登录</p>';

    const batchProgress = api.$('#batchProgressColumn');
    if (batchProgress) batchProgress.innerHTML = '<option value="">请重新登录</option>';
    const batchDeliverable = api.$('#batchDeliverable');
    if (batchDeliverable) batchDeliverable.innerHTML = '<option value="">请重新登录</option>';

    if (notify) {
      const msg = reason === 'logout'
        ? '⚠️ 已退出登录，请在扩展弹窗中重新登录'
        : '⏰ 会话已过期，工作空间缓存已清空，请在扩展弹窗中重新登录';
      api.showR('singleResult', 'error', msg);
      api.showR('batchResult', 'error', msg);
    }
  };

  /**
   * 检测登录态翻转：已登录 → 未登录/过期时清缓存并提示。
   * @param {boolean} nextLoggedIn
   * @param {{ expired?: boolean, tokenPresent?: boolean }} [meta]
   */
  api.handleAuthSessionTransition = function (nextLoggedIn, meta = {}) {
    const prev = state.wasLoggedIn;
    state.wasLoggedIn = nextLoggedIn;
    if (!prev || nextLoggedIn) return;
    const reason = meta.tokenPresent || meta.expired ? 'expired' : 'logout';
    api.clearWorkspaceAuthCaches({ reason, notify: true });
  };

  api.refreshAuthState = async function () {
    let expired = false;
    let expiryHint = null;
    try {
      const r = await api.sendMessage({ action: 'getAuthStatus', _timeout: 5000 });
      if (r?.success && r.data) {
        state.apiConfig = {
          baseUrl: r.data.baseUrl,
          token: r.data.token || '',
          tokenExpiresAt: r.data.tokenExpiresAt || 0,
          tokenIssuedAt: r.data.tokenIssuedAt || 0,
        };
        if (r.data.userId) state.currentUserId = String(r.data.userId);
        if (r.data.memberId) state.currentMemberId = String(r.data.memberId);
        expired = !!r.data.expired;
        state.isLoggedIn = !!r.data.loggedIn;
        expiryHint = r.data.expiryHint || Storage.formatTokenExpiryHint(r.data.remainingSeconds);
      } else {
        throw new Error(r?.error || 'getAuthStatus 失败');
      }
    } catch (_) {
      state.apiConfig = await Storage.getApiConfig();
      const cred = await Storage.getCredentials();
      if (cred.userId) state.currentUserId = String(cred.userId);
      if (cred.memberId) state.currentMemberId = String(cred.memberId);
      expired = await Storage.isTokenExpired();
      state.isLoggedIn = !!(state.apiConfig.token && !expired);
      const remaining = await Storage.getTokenRemainingSeconds();
      expiryHint = Storage.formatTokenExpiryHint(remaining);
    }
    api.handleAuthSessionTransition(state.isLoggedIn, {
      expired,
      tokenPresent: !!state.apiConfig.token,
    });
    api.updateStatusBadge(expired, expiryHint);
    return state.isLoggedIn;
  };

  api.ensureApiReady = async function () {
    await api.refreshAuthState();
    return state.isLoggedIn;
  };

  api.handleApiAuthFailure = function (err) {
    const msg = String(err?.message || err || '');
    if (!/\b401\b/.test(msg)) return false;
    const prev = state.wasLoggedIn || state.isLoggedIn;
    state.isLoggedIn = false;
    state.wasLoggedIn = false;
    api.updateStatusBadge(true);
    if (prev) {
      api.clearWorkspaceAuthCaches({ reason: 'auth_failure', notify: true });
    }
    return true;
  };

  api.bindAuthListener = function () {
    const refreshFromStorage = () => {
      api.refreshAuthState().then((loggedIn) => {
        if (loggedIn) {
          api.loadWorkspaces('singleWorkspace');
          if (api.$('#batchWorkspace')) {
            api.loadWorkspaces('batchWorkspace');
          }
        }
      }).catch((e) => {
        console.warn('[taskChromePlugin] panel storage 登录态刷新失败:', e.message);
      });
    };
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (!changes.token && !changes.tokenExpiresAt && !changes.baseUrl && !changes.userId && !changes.memberId) {
          return;
        }
        refreshFromStorage();
      });
    } catch (e) {
      console.warn('[taskChromePlugin] panel bindAuthListener 失败:', e.message);
    }
  };

  api.updateStatusBadge = function (expired = false, expiryHint = null) {
    const badge = api.$('#statusBadge');
    if (!badge) return;
    if (!state.apiConfig.token) {
      badge.textContent = '⚠️ 未登录';
      badge.className = 'badge badge-disconnected';
      badge.title = '请先在扩展弹窗中登录';
      return;
    }
    if (expired || !state.isLoggedIn) {
      badge.textContent = '⏰ 会话过期';
      badge.className = 'badge badge-disconnected';
      badge.title = '请在扩展弹窗中重新登录';
      return;
    }
    if (expiryHint?.text) {
      badge.textContent = expiryHint.text;
      badge.className = expiryHint.level === 'critical' ? 'badge badge-disconnected' : 'badge badge-warning';
      badge.title = '登录会话即将过期，请尽快重新登录';
      return;
    }
    badge.textContent = '✅ 已连接';
    badge.className = 'badge badge-connected';
    badge.title = '';
  };

  api.startAuthBadgeTimer = function () {
    if (state.authBadgeCtl) {
      state.authBadgeCtl.stop();
      state.authBadgeCtl = null;
    }
    if (state.authBadgeTimer) {
      clearInterval(state.authBadgeTimer);
      state.authBadgeTimer = null;
    }
    if (typeof startDocumentVisibilityInterval !== 'function') return;
    state.authBadgeCtl = startDocumentVisibilityInterval(AUTH_BADGE_REFRESH_MS, () => api.refreshAuthState().then((loggedIn) => {
      if (!loggedIn || typeof FloatWorkspaceSelect === 'undefined') return;
      const needs = (id) => FloatWorkspaceSelect.selectNeedsWorkspaceLoad(api.$(`#${id}`), {
        workspacesCount: 0,
      });
      if (needs('singleWorkspace')) {
        console.info('[taskChromePlugin] panel 已登录但工作空间未加载，补拉');
        api.loadWorkspaces('singleWorkspace');
      }
      if (api.$('#batchWorkspace') && needs('batchWorkspace')) {
        api.loadWorkspaces('batchWorkspace');
      }
    }).catch((e) => {
      console.warn('[taskChromePlugin] panel 定时刷新登录态失败:', e.message);
    }));
  };

  api.checkConnection = async function () {
    try {
      const res = await api.sendMessage({ action: 'ping' });
      if (!res?.pong) throw new Error('No pong');
    } catch (_) {}
  };

  /**
   * 带超时的 chrome.runtime.sendMessage 封装
   * 超时时返回 { error: '消息超时' } 而非 reject，保持与现有 .success 检查模式的兼容
   * @param {object} msg - 消息对象，可包含 _timeout 字段自定义超时(ms)
   */
  api.sendMessage = function (msg) {
    const timeoutMs = msg._timeout || 15000;
    const cleanMsg = { ...msg };
    delete cleanMsg._timeout;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ error: `消息超时 (${timeoutMs}ms): ${cleanMsg.action || 'unknown'}` });
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(cleanMsg)
          .then((resp) => { clearTimeout(timer); resolve(resp); })
          .catch((err) => {
            clearTimeout(timer);
            resolve({ error: err?.message || '消息发送失败' });
          });
      } catch (syncErr) {
        clearTimeout(timer);
        resolve({ error: syncErr?.message || '消息发送异常' });
      }
    });
  };

  /**
   * 经 Service Worker 调用业务 API（与悬浮面板同源，走 initApiFromMessage）
   */
  api.swApi = async function (action, extra = {}, timeoutMs = 15000) {
    const r = await api.sendMessage({
      action,
      baseUrl: state.apiConfig.baseUrl,
      token: state.apiConfig.token,
      _timeout: timeoutMs,
      ...extra,
    });
    if (!r?.success) {
      throw new Error(r?.error || `${action} 失败`);
    }
    return r.data;
  };

  // ---- Utility ----
  api.extractPath = function (url) { try { return new URL(url).pathname; } catch (_) { return url; } };
  api.escHtml = function (s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; };
  api.showR = function (target, type, msg, traceId) {
    const el = api.$(`#${target}`);
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
  };

  return api;
})();
