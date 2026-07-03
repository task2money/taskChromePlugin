/**
 * Popup 脚本 — 登录、连接状态、请求快速预览
 * 任务创建请使用 DevTools Panel (F12 → TaskPlugin)
 */

const Popup = (() => {
  const $ = (sel) => document.querySelector(sel);

  let loginMethod = 'password';
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

  async function init() {
    // 打开 popup 即表示用户已看到错误，重置角标
    try { chrome.runtime.sendMessage({ action: 'resetBadge' }); } catch (_) { /* ignore */ }
    bindEvents();

    // 4 秒后如果 spinner 还在，显示重试按钮
    initRetryTimer = setTimeout(() => {
      const spinner = $('#loadingSpinner');
      const retryBtn = $('#btnRetryInit');
      if (spinner && spinner.style.display !== 'none' && retryBtn) {
        retryBtn.style.display = 'inline-block';
      }
    }, 4000);

    try {
      await loadState();
    } catch (e) {
      console.error('[TaskPlugin] loadState 失败:', e);
      // 出错时回退到未登录状态，让用户可以重新登录
      showLoginUI();
    } finally {
      // 无论如何都要隐藏 loading spinner
      clearTimeout(initRetryTimer);
      const spinner = $('#loadingSpinner');
      if (spinner) spinner.style.display = 'none';
      const retryBtn = $('#btnRetryInit');
      if (retryBtn) retryBtn.style.display = 'none';
    }
  }

  async function retryInit() {
    // 隐藏之前的错误 UI，重新显示 spinner
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

    // 重新执行 init 流程
    await init();
  }

  function showLoginUI() {
    const status = $('#popupStatus');
    const headerArea = $('#headerUserArea');
    const loginSec = $('#loginSection');
    const devGuide = $('#devtoolsGuide');
    const reqSec = $('#requestsSection');
    if (status) { status.style.display = 'inline'; status.textContent = '⚠️ 未登录'; status.className = 'badge badge-disconnected'; }
    if (headerArea) headerArea.style.display = 'none';
    if (loginSec) loginSec.style.display = 'block';
    if (devGuide) devGuide.style.display = 'none';
    if (reqSec) reqSec.style.display = 'none';
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
    if (headerUser) headerUser.textContent = '👤 ' + (username || '(访问令牌)');
    if (loginSec) loginSec.style.display = 'none';
    if (devGuide) devGuide.style.display = 'block';
    if (reqSec) reqSec.style.display = 'block';
  }

  async function loadState() {
    const cfg = await Storage.getApiConfig();
    const cred = await Storage.getCredentials();

    const OLD_DEFAULT = 'http://183.250.1.132:4000';
    const NEW_DEFAULT = 'http://183.250.1.132:18081';
    let baseUrl = cfg.baseUrl || '';
    if (baseUrl === OLD_DEFAULT) {
      baseUrl = NEW_DEFAULT;
      await Storage.saveApiConfig(NEW_DEFAULT, cfg.token || '');
    }

    const baseUrlInput = $('#baseUrl');
    const usernameInput = $('#username');
    if (baseUrlInput) baseUrlInput.value = baseUrl;
    if (usernameInput && cred.username) usernameInput.value = cred.username;

    if (cfg.token) {
      showLoggedInUI(cred.username);
      // 异步加载子模块 — 使用 Promise.allSettled 确保不会因单个失败而阻塞
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
    } else {
      showLoginUI();
    }
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

  function setLoginMethod(method) {
    loginMethod = method;
    if (method === 'password') {
      $('#btnMethodPassword').className = 'btn btn-sm btn-primary';
      $('#btnMethodToken').className = 'btn btn-sm';
      $('#passwordFields').style.display = 'block';
      $('#tokenFields').style.display = 'none';
    } else {
      $('#btnMethodPassword').className = 'btn btn-sm';
      $('#btnMethodToken').className = 'btn btn-sm btn-primary';
      $('#passwordFields').style.display = 'none';
      $('#tokenFields').style.display = 'block';
    }
    $('#loginResult').className = 'result';
  }

  function bindEvents() {
    $('#btnMethodPassword').addEventListener('click', () => setLoginMethod('password'));
    $('#btnMethodToken').addEventListener('click', () => setLoginMethod('token'));
    $('#btnToggleTokenVisibility').addEventListener('click', () => {
      const input = $('#accessToken');
      const btn = $('#btnToggleTokenVisibility');
      if (input.type === 'password') { input.type = 'text'; btn.textContent = '🙈'; }
      else { input.type = 'password'; btn.textContent = '👁'; }
    });
    $('#btnLogin').addEventListener('click', handleLogin);
    $('#password').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
    $('#accessToken').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });

    // 退出登录
    $('#btnLogout').addEventListener('click', handleLogout);

    // 重试初始化
    $('#btnRetryInit').addEventListener('click', retryInit);

    // 悬浮球开关
    $('#floatBallToggle').addEventListener('change', async () => {
      const toggle = $('#floatBallToggle');
      if (!toggle) return;
      const enabled = toggle.checked;
      await Storage.saveFloatBallConfig(enabled);
      // 通知所有 tab 的 content script 更新悬浮球显示状态
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

  // ---- 登录 / 登出 ----

  async function handleLogin() {
    const baseUrlInput = $('#baseUrl');
    const baseUrl = baseUrlInput ? baseUrlInput.value.trim() : '';
    if (!baseUrl) return showResult('loginResult', '请填写服务器地址', 'error');

    const btn = $('#btnLogin');
    if (!btn) return;
    btn.disabled = true; btn.textContent = '登录中...';

    try {
      const mapping = await Storage.getEndpointMapping();

      if (loginMethod === 'token') {
        const accessTokenInput = $('#accessToken');
        const accessToken = accessTokenInput ? accessTokenInput.value.trim() : '';
        if (!accessToken) { btn.disabled = false; btn.textContent = '🔓 登录'; return showResult('loginResult', '请填写访问令牌', 'error'); }
        const res = await sendMessageWithTimeout({
          action: 'loginWithAccessToken', baseUrl, accessToken,
          endpointMapping: mapping && Object.keys(mapping).length > 0 ? mapping : undefined,
        }, 15000);
        if (!res?.success) throw new Error(res?.error || '登录失败');
      } else {
        const usernameInput = $('#username');
        const passwordInput = $('#password');
        const username = usernameInput ? usernameInput.value.trim() : '';
        const password = passwordInput ? passwordInput.value : '';
        if (!username) { btn.disabled = false; btn.textContent = '🔓 登录'; return showResult('loginResult', '请填写用户名', 'error'); }
        if (!password) { btn.disabled = false; btn.textContent = '🔓 登录'; return showResult('loginResult', '请填写密码', 'error'); }
        const res = await sendMessageWithTimeout({
          action: 'login', baseUrl, username, password,
          endpointMapping: mapping && Object.keys(mapping).length > 0 ? mapping : undefined,
        }, 15000);
        if (!res?.success) throw new Error(res?.error || '登录失败');
      }

      showResult('loginResult', '✅ 登录成功!', 'success');
      setTimeout(async () => { await loadState(); }, 300);
    } catch (e) {
      showResult('loginResult', `❌ 登录失败: ${e.message}`, 'error');
    } finally { btn.disabled = false; btn.textContent = '🔓 登录'; }
  }

  async function handleLogout() {
    await Storage.saveApiConfig('', '');
    await Storage.saveCredentials('', '');
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

  function renderRequestList() {
    const search = ($('#reqSearch').value || '').toLowerCase();
    const statusFilter = $('#reqStatusFilter').value;

    let filtered = capturedRequests.filter(r => {
      if (search) {
        const url = (r.url || '').toLowerCase();
        const m = (r.method || '').toLowerCase();
        const sc = String(r.statusCode || '');
        if (!url.includes(search) && !m.includes(search) && !sc.includes(search)) return false;
      }
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
      const scCls = req.statusCode >= 500 ? 'err-5xx' : (req.statusCode >= 400 ? 'err-4xx' : 'err-ok');
      const sel = selectedReqId === req.id ? ' selected' : '';
      const urlShort = (req.url || '').length > 60 ? req.url.slice(0, 60) + '…' : (req.url || '');
      html += `<div class="popup-req-item${sel}" data-id="${req.id}">
        <span class="req-method ${req.method}">${req.method}</span>
        <span class="req-status ${scCls}">${req.statusCode}</span>
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
    // 更新列表高亮
    document.querySelectorAll('.popup-req-item').forEach(x => x.classList.remove('selected'));
    const tgt = document.querySelector(`.popup-req-item[data-id="${req.id}"]`);
    if (tgt) tgt.classList.add('selected');

    // 渲染详情
    const el = $('#popupReqDetail');
    if (!el) return;
    el.style.display = 'block';

    // 请求头
    let reqHdrHtml = '';
    if (req.requestHeaders && Object.keys(req.requestHeaders).length) {
      reqHdrHtml = '<div class="detail-section"><h4>📤 请求头</h4>' +
        Object.entries(req.requestHeaders).map(([k, v]) =>
          `<span class="hdr-pair"><strong>${escHtml(k)}:</strong> ${escHtml(String(v))}</span>`
        ).join('<br>') + '</div>';
    }

    // 响应头
    let resHdrHtml = '';
    if (req.responseHeaders && Object.keys(req.responseHeaders).length) {
      resHdrHtml = '<div class="detail-section"><h4>📥 响应头</h4>' +
        Object.entries(req.responseHeaders).map(([k, v]) =>
          `<span class="hdr-pair"><strong>${escHtml(k)}:</strong> ${escHtml(String(v))}</span>`
        ).join('<br>') + '</div>';
    }

    el.innerHTML = `<div style="margin-bottom:6px">
      <span class="req-method ${req.method}">${req.method}</span>
      <span class="req-status ${req.statusCode >= 400 ? 'err-4xx' : 'err-ok'}">${req.statusCode}</span>
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
