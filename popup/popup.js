/** Popup 事件绑定、请求预览、启动（最后加载，OPT-20260821-004）. */
  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    // 登录/登出写 chrome.storage.local 后刷新弹窗（不向其它标签页 sendMessage）
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.floatBallEnabled !== undefined) {
          const toggle = $('#floatBallToggle');
          if (toggle) toggle.checked = changes.floatBallEnabled.newValue !== false;
        }
        if (!changes.token && !changes.tokenExpiresAt && !changes.baseUrl && !changes.userId && !changes.memberId) {
          return;
        }
        withTimeout(loadState(), STATE_CHECK_TIMEOUT, '刷新登录态').catch(() => showLoginUI());
      });
    } catch (_) { /* ignore */ }

    // 登录按钮 — OAuth2+PKCE（OPT-20260808-024）
    const btnLogin = $('#btnLogin');
    if (btnLogin) btnLogin.addEventListener('click', handleOAuthLogin);

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

    // 悬浮球开关 — Anti-Replay-OK: ui-only（仅写本地 storage，无 HTTP 写接口）
    const floatToggle = $('#floatBallToggle');
    if (floatToggle) {
      floatToggle.addEventListener('change', async () => {
        const enabled = floatToggle.checked;
        try {
          await withTimeout(Storage.saveFloatBallConfig(enabled), STORAGE_READ_TIMEOUT, '保存悬浮球配置');
        } catch (_) { /* ignore */ }
        // OPT-20260821-008: 只写 storage；content 监听 floatBallEnabled onChanged 自更新，
        // 不再向全部标签页 sendMessage（与登录/快捷键同类的跨 tab 扇出已下线）。
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

    // 快捷键说明：默认收起，点击「展开」后显示（面板更窄，说明按需展开）
    const btnToggleShortcuts = $('#btnToggleShortcuts');
    if (btnToggleShortcuts) {
      btnToggleShortcuts.addEventListener('click', () => {
        const body = $('#shortcutsBody');
        if (!body) return;
        if (body.style.display === 'none') { body.style.display = 'block'; btnToggleShortcuts.textContent = '收起'; }
        else { body.style.display = 'none'; btnToggleShortcuts.textContent = '展开'; }
      });
    }

    // 元素拾取快捷键自定义（默认 mac ⌘+Shift+X / 其他 Ctrl+Shift+X，可改任意组合）
    const btnPickShortcutEdit = $('#btnPickShortcutEdit');
    if (btnPickShortcutEdit) btnPickShortcutEdit.addEventListener('click', startShortcutCapture);
    const btnPickShortcutReset = $('#btnPickShortcutReset');
    if (btnPickShortcutReset) btnPickShortcutReset.addEventListener('click', resetShortcut);

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
    const reqSort = $('#reqSort');
    if (reqSort) reqSort.addEventListener('change', renderRequestList);
  }

  // ---- OAuth2+PKCE 登录（OPT-20260808-024）----

  /**
   * 发起 OAuth 登录：校验服务器地址 → 保存 → 通知 SW 打开授权页。
   * 授权完成后 oauth-callback 页通知 SW 完成 token 交换与持久化。
   */
  async function handleOAuthLogin() {
    const baseUrlInput = $('#baseUrl');
    const baseUrl = baseUrlInput ? baseUrlInput.value.trim() : '';
    if (!baseUrl) return showResult('loginResult', '请填写服务器地址', 'error');

    const btn = $('#btnLogin');
    const loginResult = $('#loginResult');
    if (!btn) return;

    if (loginResult) { loginResult.className = 'result'; loginResult.textContent = ''; }

    btn.disabled = true;
    btn.textContent = '⏳ 等待授权...';

    // 保存地址不得阻塞登录：chrome.storage 挂起时历史上会导致点击无响应
    try {
      await withTimeout(Storage.saveBaseUrl(baseUrl), STORAGE_READ_TIMEOUT, '保存服务器地址');
    } catch (e) {
      console.warn('[TaskPlugin] 保存服务器地址失败（继续登录）:', e.message || e);
    }

    try {
      const res = await sendMessageWithTimeout({
        action: 'oauthStart',
        baseUrl,
      }, 30000);
      if (res?.success) {
        showResult('loginResult', '✅ 已打开授权页，完成授权后请返回本弹窗', 'ok');
      } else {
        showResult('loginResult', `❌ ${res?.error || '登录失败'}`, 'error', res?.traceId);
      }
    } catch (e) {
      showResult('loginResult', `❌ ${e.message || '登录失败'}`, 'error', e.traceId);
    } finally {
      btn.disabled = false;
      if ($('#loginSection')?.style.display !== 'none') {
        btn.textContent = '🔓 OAuth 登录';
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
    const Q = globalThis.RequestListQuery;
    const search = $('#reqSearch') ? ($('#reqSearch').value || '') : '';
    const statusFilter = $('#reqStatusFilter') ? $('#reqStatusFilter').value : '';
    const sortKey = $('#reqSort') ? ($('#reqSort').value || 'timestamp') : 'timestamp';
    const sortDir = sortKey === 'url' ? 'asc' : 'desc';
    const filtered = Q.filterRequests(capturedRequests, { search, status: statusFilter });
    const sorted = Q.sortRequests(filtered, { key: sortKey, dir: sortDir });
    const display = sorted.slice(0, 50);
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
      <span style="font-size:10px;color:#89b4fa;">💡 按 <kbd style="background:#45475a;color:#cdd6f4;padding:1px 5px;border-radius:3px;font-size:9px">F12</kbd> → <b>云端Coding: 自动创新助手</b> 面板创建任务</span>
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

var Popup = { init };

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
