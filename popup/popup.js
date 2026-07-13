/**
 * Popup 脚本 — 账号+令牌登录、连接状态、请求快速预览
 * 任务创建请使用 DevTools Panel (F12 → TaskPlugin)
 */

const Popup = (() => {
  const $ = (sel) => document.querySelector(sel);

  let capturedRequests = [];
  let selectedReqId = null;

  /**
   * 带超时的 chrome.runtime.sendMessage 封装
   * 防止 Service Worker 未就绪时消息无限挂起导致 popup 卡死
   */
  function sendMessageWithTimeout(action, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`消息超时: ${action.action || action}`));
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(action)
          .then((res) => { clearTimeout(timer); resolve(res); })
          .catch((err) => { clearTimeout(timer); reject(err); });
      } catch (syncErr) {
        clearTimeout(timer);
        reject(syncErr);
      }
    });
  }

  let initRetryTimer = null;
  const STATE_CHECK_TIMEOUT = 5000; // 登录状态检查最长 5 秒

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

  async function init() {
    // 打开 popup 即表示用户已看到错误，重置角标
    try { chrome.runtime.sendMessage({ action: 'resetBadge' }); } catch (_) { /* ignore */ }
    bindEvents();

    // 先恢复上次服务器地址/账号，避免状态检查失败时回落到 HTML 默认值
    try {
      await restoreRememberedFormFields();
    } catch (e) {
      console.warn('[TaskPlugin] 恢复表单字段失败:', e);
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
      // 状态检查必须在 5 秒内完成，超时视为登录失败
      await Promise.race([
        loadState(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('登录状态检查超时，请检查网络后重试')), STATE_CHECK_TIMEOUT)
        ),
      ]);
    } catch (e) {
      console.error('[TaskPlugin] loadState 失败:', e);
      showLoginUI(e.message || undefined);
      try { await restoreRememberedFormFields(); } catch (_) { /* ignore */ }
    } finally {
      clearTimeout(initRetryTimer);
      const spinner = $('#loadingSpinner');
      if (spinner) spinner.style.display = 'none';
      const retryBtn = $('#btnRetryInit');
      if (retryBtn) retryBtn.style.display = 'none';
    }
  }

  async function retryInit() {
    const spinner = $('#loadingSpinner');
    const retryBtn = $('#btnRetryInit');
    const loginSec = $('#loginSection');
    const devGuide = $('#devtoolsGuide');
    const reqSec = $('#requestsSection');
    if (spinner) spinner.style.display = 'flex';
    if (retryBtn) retryBtn.style.display = 'none';
    if (loginSec) loginSec.style.display = 'none';
    if (devGuide) devGuide.style.display = 'none';
    if (reqSec) reqSec.style.display = 'none';

    await init();
  }

  function showLoginUI(errorMessage) {
    const status = $('#popupStatus');
    const headerArea = $('#headerUserArea');
    const loginSec = $('#loginSection');
    const devGuide = $('#devtoolsGuide');
    const reqSec = $('#requestsSection');
    const loginHint = $('#loginHint');
    const loginResult = $('#loginResult');

    if (status) { status.style.display = 'inline'; status.textContent = '⚠️ 未登录'; status.className = 'badge badge-disconnected'; }
    if (headerArea) headerArea.style.display = 'none';
    if (loginSec) loginSec.style.display = 'block';
    if (devGuide) devGuide.style.display = 'none';
    if (reqSec) reqSec.style.display = 'none';

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
    const reqSec = $('#requestsSection');
    if (loginSec) loginSec.style.display = 'block';
    if (devGuide) devGuide.style.display = 'none';
    if (reqSec) reqSec.style.display = 'none';

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
    const reqSec = $('#requestsSection');
    if (status) status.style.display = 'none';
    if (headerArea) headerArea.style.display = 'flex';
    if (headerUser) headerUser.textContent = '👤 ' + (username || '(已登录)');
    if (loginSec) loginSec.style.display = 'none';
    if (devGuide) devGuide.style.display = 'block';
    if (reqSec) reqSec.style.display = 'block';
  }

  async function loadState() {
    const cfg = await Storage.getApiConfig();
    const cred = await Storage.getCredentials();

    const baseUrl = cfg.baseUrl;

    const baseUrlInput = $('#baseUrl');
    if (baseUrlInput) baseUrlInput.value = baseUrl;

    const usernameInput = $('#username');
    if (usernameInput && cred.username && !cred.username.startsWith('(')) {
      usernameInput.value = cred.username;
    }

    if (cfg.token) {
      // 检查 token 是否过期
      const isExpired = await Storage.isTokenExpired();
      if (isExpired) {
        showTokenExpiredUI(cred.username);
        return;
      }

      // 立即显示已登录 UI（不等待子模块）
      showLoggedInUI(cred.username);

      // 子模块异步延迟加载 — 不阻塞登录状态检查
      loadSubModules();
    } else {
      showLoginUI();
    }
  }

  /**
   * 延迟加载子模块（悬浮球配置、跟踪配置、请求列表、token 有效期提醒）
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

    // 后台检查 token 剩余时间，接近过期时显示提醒
    try {
      const remaining = await Storage.getTokenRemainingSeconds();
      if (remaining > 0 && remaining < 300) { // 5 分钟内过期
        const status = $('#popupStatus');
        if (status) {
          const mins = Math.ceil(remaining / 60);
          status.style.display = 'inline';
          status.textContent = `⏰ ${mins}分钟后过期`;
          status.className = 'badge badge-warning';
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

  function bindEvents() {
    // 登录按钮 — 账号 + 访问令牌
    $('#btnLogin').addEventListener('click', handleTokenLogin);

    // 退出登录
    $('#btnLogout').addEventListener('click', handleLogout);

    // 服务器地址：失焦/变更时自动保留上次输入
    const baseUrlInput = $('#baseUrl');
    if (baseUrlInput) {
      baseUrlInput.addEventListener('change', () => { persistBaseUrlFromInput().catch(() => {}); });
      baseUrlInput.addEventListener('blur', () => { persistBaseUrlFromInput().catch(() => {}); });
    }

    // 重试初始化
    $('#btnRetryInit').addEventListener('click', retryInit);

    // 悬浮球开关
    $('#floatBallToggle').addEventListener('change', async () => {
      const toggle = $('#floatBallToggle');
      if (!toggle) return;
      const enabled = toggle.checked;
      await Storage.saveFloatBallConfig(enabled);
      try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, { action: 'setFloatBallEnabled', enabled }).catch(() => {});
        }
      } catch (_) { /* ignore */ }
    });

    // 跟踪开关
    $('#trackingToggle').addEventListener('change', async () => {
      const toggle = $('#trackingToggle');
      if (!toggle) return;
      const enabled = toggle.checked;
      try {
        await sendMessageWithTimeout({ action: 'setTrackingConfig', enabled }, 5000);
      } catch (_) { /* ignore */ }
    });

    // 请求列表
    $('#btnToggleRequests').addEventListener('click', () => {
      const body = $('#requestsBody'); const btn = $('#btnToggleRequests');
      if (body.style.display === 'none') { body.style.display = 'block'; btn.textContent = '收起'; }
      else { body.style.display = 'none'; btn.textContent = '展开'; }
    });
    $('#btnRefreshReqs').addEventListener('click', loadCapturedRequests);
    $('#btnClearReqs').addEventListener('click', clearCapturedRequests);
    $('#reqSearch').addEventListener('input', renderRequestList);
    $('#reqStatusFilter').addEventListener('change', renderRequestList);
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

    // 登录成功与否都先记住服务器地址
    await Storage.saveBaseUrl(baseUrl);

    const btn = $('#btnLogin');
    const loginResult = $('#loginResult');
    if (!btn) return;

    if (loginResult) { loginResult.className = 'result'; loginResult.textContent = ''; }

    btn.disabled = true;
    btn.textContent = '⏳ 登录中...';

    try {
      const res = await sendMessageWithTimeout({
        action: 'loginWithAccessToken',
        baseUrl,
        username,
        accessToken,
      }, 30000);

      if (res?.success) {
        notifyContentScriptsAuthChanged();
        await loadState();
      } else {
        showResult('loginResult', `❌ ${res?.error || '登录失败'}`, 'error');
        btn.textContent = '🔓 登录';
      }
    } catch (e) {
      showResult('loginResult', `❌ ${e.message || '登录失败'}`, 'error');
      btn.textContent = '🔓 登录';
    } finally {
      btn.disabled = false;
    }
  }

  // ---- 登出 ----

  async function handleLogout() {
    // 仅清除登录态，保留上次服务器地址
    await Storage.clearAuth();
    notifyContentScriptsAuthChanged();
    await loadState();
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

  function showResult(targetId, msg, type) {
    const el = $(`#${targetId}`);
    if (!el) return;
    el.textContent = msg; el.className = `result ${type}`;
    setTimeout(() => { el.className = 'result'; }, 8000);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => Popup.init());
