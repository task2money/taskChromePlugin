/** Popup：仅在「调用系统智能体」且已登录后显示 SKU 下拉；未登录提示先登录。 */
(function () {
  const Lib = () => (typeof PopupSystemSkuMenu !== 'undefined' ? PopupSystemSkuMenu : null);
  const row = () => document.querySelector('#popupLlmSystemSkuRow');
  const selectEl = () => document.querySelector('#popupLlmSystemSku');
  const hintEl = () => document.querySelector('#popupLlmSystemLoginHint');
  const statusEl = () => document.querySelector('#popupLlmSystemSkuStatus');
  const retryEl = () => document.querySelector('#popupLlmSystemSkuRetry');
  let suppress = false;
  let loadGen = 0;
  let retrying = false;
  let loggedIn = false;
  let routeMode = 'direct';
  let lastSkuId = '';

  function setRetryVisible(visible) {
    const btn = retryEl();
    if (!btn) return;
    btn.hidden = !visible;
    btn.disabled = false;
  }

  function clearStatus() {
    const st = statusEl();
    setRetryVisible(false);
    if (!st) return;
    st.textContent = '';
    if (typeof setDataTraceId === 'function') setDataTraceId(st, '');
  }

  function showError(err) {
    const st = statusEl();
    if (!st) return;
    const detail = err?.message || '';
    st.textContent = (typeof tx === 'function')
      ? tx('commonLoadFailed', { msg: detail })
      : detail;
    if (typeof setDataTraceId === 'function') setDataTraceId(st, err);
    setRetryVisible(true);
    console.warn('[taskChromePlugin] popup system sku load failed', {
      traceId: err?.traceId || '',
    });
  }

  function retry() {
    if (retrying) return;
    retrying = true;
    const btn = retryEl();
    if (btn) btn.disabled = true;
    Promise.resolve()
      .then(() => loadMenu())
      .catch((e) => showError(e))
      .then(() => {
        retrying = false;
        const b = retryEl();
        if (b) b.disabled = false;
      });
  }

  function persist(id) {
    lastSkuId = String(id || '').trim();
    if (typeof PageAdvisorLlmConfig === 'undefined' || typeof PageAdvisorLlmConfig.saveToStorage !== 'function') {
      return;
    }
    PageAdvisorLlmConfig.saveToStorage({
      routeMode: 'system',
      systemSkuId: lastSkuId,
      profileAction: 'route-only',
    }).catch((e) => {
      console.warn('[taskChromePlugin] save system sku failed', { message: e?.message || '' });
    });
  }

  function resolveMode() {
    const lib = Lib();
    if (lib) return lib.systemSkuUiMode(loggedIn, routeMode);
    if (routeMode !== 'system') return 'hidden';
    return loggedIn ? 'menu' : 'login_required';
  }

  function applyVisibility(mode) {
    const lib = Lib();
    const target = row();
    const hint = hintEl();
    const sel = selectEl();
    if (lib) {
      lib.applySystemSkuRow(target, mode);
      lib.applySystemSkuLoginGate({ hint, select: sel }, mode);
      return;
    }
    if (target) {
      const visible = mode !== 'hidden';
      target.hidden = !visible;
      if (target.style) target.style.display = visible ? '' : 'none';
    }
    if (hint) hint.hidden = mode !== 'login_required';
    if (sel) sel.hidden = mode !== 'menu';
  }

  function unwrapItems(data) {
    if (Array.isArray(data)) return data;
    return data?.items || data?.results || data?.data || [];
  }

  function render(menu) {
    const sel = selectEl();
    if (!sel || !menu) return;
    suppress = true;
    try {
      sel.disabled = false;
      sel.hidden = false;
      sel.replaceChildren();
      if (!menu.options.length) {
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = (typeof tx === 'function') ? tx('paLlmSystemEmpty') : '-- 暂无可用系统智能体 --';
        sel.appendChild(empty);
        sel.value = '';
        return;
      }
      if (!menu.selectedId) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = (typeof tx === 'function') ? tx('paLlmSystemSelect') : '-- 请选择系统智能体 --';
        sel.appendChild(placeholder);
      }
      for (const item of menu.options) {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item.label;
        sel.appendChild(opt);
      }
      sel.value = menu.selectedId || '';
      if (menu.selectedId) lastSkuId = menu.selectedId;
    } finally {
      suppress = false;
    }
    if (menu.persist && menu.selectedId) persist(menu.selectedId);
  }

  async function loadMenu() {
    const gen = ++loadGen;
    const sel = selectEl();
    if (sel) {
      suppress = true;
      sel.hidden = false;
      sel.disabled = false;
      sel.replaceChildren();
      const loading = document.createElement('option');
      loading.value = '';
      loading.textContent = (typeof tx === 'function') ? tx('commonLoading') : '加载中…';
      sel.appendChild(loading);
      suppress = false;
    }
    clearStatus();
    if (typeof PageAdvisorLlmConfig !== 'undefined' && typeof PageAdvisorLlmConfig.loadFromStorage === 'function') {
      try {
        const cfg = await PageAdvisorLlmConfig.loadFromStorage();
        if (cfg && cfg.systemSkuId) lastSkuId = String(cfg.systemSkuId);
      } catch (_) { /* 沿用内存 lastSkuId */ }
    }
    if (gen !== loadGen) return;
    if (typeof sendMessageWithTimeout !== 'function') return;
    let response;
    try {
      response = await sendMessageWithTimeout({ action: 'getSystemAgents' }, 12000);
    } catch (e) {
      if (gen !== loadGen) return;
      showError(e);
      return;
    }
    if (gen !== loadGen) return;
    if (!response || response.success === false) {
      const err = new Error(response?.error || 'getSystemAgents failed');
      if (response?.traceId) err.traceId = response.traceId;
      showError(err);
      return;
    }
    const lib = Lib();
    render(lib
      ? lib.buildSystemSkuMenu(unwrapItems(response.data), lastSkuId)
      : { options: [], selectedId: '', persist: false });
  }

  function refreshUi() {
    const mode = resolveMode();
    applyVisibility(mode);
    if (mode === 'hidden') {
      loadGen += 1;
      clearStatus();
      return;
    }
    if (mode === 'login_required') {
      loadGen += 1;
      clearStatus();
      if (typeof window.PopupAuth?.promptLogin === 'function') {
        window.PopupAuth.promptLogin({ reason: 'system_agent' });
      }
      return;
    }
    loadMenu().catch((e) => showError(e));
  }

  function setLoggedIn(next) {
    loggedIn = Boolean(next);
    refreshUi();
  }

  function syncRoute(nextRoute) {
    routeMode = String(nextRoute || '') === 'system' ? 'system' : 'direct';
    refreshUi();
  }

  function currentSkuId() {
    if (resolveMode() !== 'menu') return lastSkuId;
    return String(selectEl()?.value || lastSkuId || '').trim();
  }

  function bind() {
    const retryBtn = retryEl();
    if (retryBtn && retryBtn.dataset.systemSkuRetryBound !== '1') {
      retryBtn.dataset.systemSkuRetryBound = '1';
      retryBtn.addEventListener('click', retry);
    }
    const sel = selectEl();
    if (!sel || sel.dataset.systemSkuBound === '1') return;
    sel.dataset.systemSkuBound = '1';
    // Anti-Replay-OK: ui-only local chrome.storage write, no HTTP mutation.
    sel.addEventListener('change', () => {
      if (suppress) return;
      persist(sel.value);
    });
  }

  window.PopupSystemSku = { setLoggedIn, syncRoute, loadMenu, currentSkuId };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
