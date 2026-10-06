/** Popup：仅在「调用平台后端」且已登录后显示智能体下拉；未登录提示先登录。 */
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
    console.warn('[taskChromePlugin] popup platform agent load failed', {
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

  function persistFromValue(value) {
    const lib = Lib();
    const parsed = lib && typeof lib.parsePlatformAgentValue === 'function'
      ? lib.parsePlatformAgentValue(value)
      : { routeMode: 'saas', systemSkuId: '' };
    lastSkuId = parsed.systemSkuId;
    routeMode = parsed.routeMode;
    if (typeof PageAdvisorLlmConfig === 'undefined' || typeof PageAdvisorLlmConfig.saveToStorage !== 'function') {
      return;
    }
    PageAdvisorLlmConfig.saveToStorage({
      routeMode: parsed.routeMode,
      systemSkuId: parsed.systemSkuId,
      profileAction: 'route-only',
    }).catch((e) => {
      console.warn('[taskChromePlugin] save platform agent failed', { message: e?.message || '' });
    });
  }

  function resolveMode() {
    const lib = Lib();
    if (lib) return lib.systemSkuUiMode(loggedIn, routeMode);
    if (routeMode !== 'saas' && routeMode !== 'system') return 'hidden';
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
      let groupEl = null;
      let currentGroup = '';
      for (const item of menu.options) {
        if (item.group && item.group !== currentGroup) {
          groupEl = document.createElement('optgroup');
          groupEl.label = item.group;
          sel.appendChild(groupEl);
          currentGroup = item.group;
        }
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item.label;
        (groupEl || sel).appendChild(opt);
      }
      sel.value = menu.selectedId || '';
      const lib = Lib();
      if (lib && typeof lib.parsePlatformAgentValue === 'function') {
        const parsed = lib.parsePlatformAgentValue(sel.value);
        lastSkuId = parsed.systemSkuId;
        routeMode = parsed.routeMode;
      }
    } finally {
      suppress = false;
    }
  }

  function menuLabels() {
    const own = (typeof tx === 'function') ? tx('paLlmOwnAgent') : '自有智能体';
    const systemGroup = (typeof tx === 'function') ? tx('paLlmSystemAgentGroup') : '系统智能体';
    return { own, ownGroup: own, systemGroup };
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
    let lastRoute = routeMode;
    if (typeof PageAdvisorLlmConfig !== 'undefined' && typeof PageAdvisorLlmConfig.loadFromStorage === 'function') {
      try {
        const cfg = await PageAdvisorLlmConfig.loadFromStorage();
        if (cfg && cfg.systemSkuId) lastSkuId = String(cfg.systemSkuId);
        if (cfg && cfg.routeMode) lastRoute = String(cfg.routeMode);
      } catch (_) { /* 沿用内存 */ }
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
    render(lib && typeof lib.buildPlatformAgentMenu === 'function'
      ? lib.buildPlatformAgentMenu(unwrapItems(response.data), lastRoute, lastSkuId, menuLabels())
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
    const value = String(nextRoute || '');
    if (value === 'saas' || value === 'system') {
      if (routeMode !== 'saas' && routeMode !== 'system') {
        routeMode = value;
      }
      refreshUi();
      return;
    }
    routeMode = 'direct';
    refreshUi();
  }

  function currentSkuId() {
    const lib = Lib();
    const raw = String(selectEl()?.value || '').trim();
    if (lib && typeof lib.parsePlatformAgentValue === 'function' && raw) {
      return lib.parsePlatformAgentValue(raw).systemSkuId;
    }
    if (resolveMode() !== 'menu') return lastSkuId;
    return lastSkuId;
  }

  function currentRouteMode() {
    const lib = Lib();
    const raw = String(selectEl()?.value || '').trim();
    if (lib && typeof lib.parsePlatformAgentValue === 'function' && raw) {
      return lib.parsePlatformAgentValue(raw).routeMode;
    }
    return routeMode === 'system' ? 'system' : 'saas';
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
      persistFromValue(sel.value);
    });
  }

  window.PopupSystemSku = {
    setLoggedIn, syncRoute, loadMenu, currentSkuId, currentRouteMode,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
