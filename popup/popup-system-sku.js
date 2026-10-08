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
  let loggedIn = false;
  let routeMode = 'direct';
  let lastSkuId = '';
  let lastOwnProvider = '';
  let lastOwnModel = '';

  // OPT-20261006-014: 重试按钮/状态条/同步点击锁统一走共用 loginGatedSelect 控制器。
  const gated = (typeof LoginGatedSelect !== 'undefined')
    ? LoginGatedSelect.createRetryController({
      retryEl,
      statusEl,
      warnLabel: 'popup platform agent',
      load: () => loadMenu(),
    })
    : null;

  function setRetryVisible(visible) { if (gated) gated.setRetryVisible(visible); }

  function clearStatus() { if (gated) gated.clearStatus(); }

  function showError(err) { if (gated) gated.showError(err); }

  function retry() { if (gated) gated.retry(); }

  function persistFromValue(value) {
    const lib = Lib();
    const parsed = lib && typeof lib.parsePlatformAgentValue === 'function'
      ? lib.parsePlatformAgentValue(value)
      : { routeMode: 'saas', systemSkuId: '', ownProvider: '', ownModel: '' };
    lastSkuId = parsed.systemSkuId;
    lastOwnProvider = parsed.ownProvider || '';
    lastOwnModel = parsed.ownModel || '';
    routeMode = parsed.routeMode;
    if (typeof PageAdvisorLlmConfig === 'undefined' || typeof PageAdvisorLlmConfig.saveToStorage !== 'function') {
      return;
    }
    PageAdvisorLlmConfig.saveToStorage({
      routeMode: parsed.routeMode,
      systemSkuId: parsed.systemSkuId,
      ownProvider: parsed.ownProvider || '',
      ownModel: parsed.ownModel || '',
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
        lastOwnProvider = parsed.ownProvider || '';
        lastOwnModel = parsed.ownModel || '';
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
    let llmCfg = null;
    if (typeof PageAdvisorLlmConfig !== 'undefined' && typeof PageAdvisorLlmConfig.loadFromStorage === 'function') {
      try {
        const cfg = await PageAdvisorLlmConfig.loadFromStorage();
        llmCfg = cfg;
        if (cfg && cfg.systemSkuId) lastSkuId = String(cfg.systemSkuId);
        if (cfg && cfg.ownProvider) lastOwnProvider = String(cfg.ownProvider);
        if (cfg && cfg.ownModel) lastOwnModel = String(cfg.ownModel);
        if (cfg && cfg.routeMode) lastRoute = String(cfg.routeMode);
      } catch (_) { /* 沿用内存 */ }
    }
    // OPT-20261006-019: 本机未显式选择调用方式时采用租户（公司）默认。
    if (!(llmCfg && String(llmCfg.routeMode || '').trim())
      && typeof sendMessageWithTimeout === 'function'
      && typeof PopupSystemSkuMenu !== 'undefined'
      && typeof PopupSystemSkuMenu.mergeLlmCfgWithTenantPrefIfUnset === 'function') {
      try {
        const prefRes = await sendMessageWithTimeout({ action: 'getTenantAgentPref' }, 8000);
        if (prefRes && prefRes.success !== false && prefRes.data) {
          const merged = PopupSystemSkuMenu.mergeLlmCfgWithTenantPrefIfUnset(llmCfg || {}, prefRes.data);
          if (merged && merged.routeMode) lastRoute = String(merged.routeMode);
          if (merged && merged.systemSkuId) lastSkuId = String(merged.systemSkuId);
          if (merged && merged.ownProvider) lastOwnProvider = String(merged.ownProvider);
          if (merged && merged.ownModel) lastOwnModel = String(merged.ownModel);
        }
      } catch (_) { /* 拉取失败沿用本机默认 */ }
    }
    if (gen !== loadGen) return;
    if (typeof sendMessageWithTimeout !== 'function') return;
    let response;
    let ownResponse;
    try {
      const [sysRes, ownRes] = await Promise.all([
        sendMessageWithTimeout({ action: 'getSystemAgents' }, 12000),
        sendMessageWithTimeout({ action: 'getOwnAgents' }, 12000).catch((e) => ({
          success: false,
          error: e?.message || 'getOwnAgents failed',
          traceId: e?.traceId || '',
        })),
      ]);
      response = sysRes;
      ownResponse = ownRes;
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
    if (ownResponse && ownResponse.success === false) {
      console.warn('[taskChromePlugin] popup own agents load failed', {
        traceId: ownResponse.traceId || '',
        message: ownResponse.error || '',
      });
    }
    const lib = Lib();
    const ownItems = (lib && typeof lib.collectOwnAgentOptions === 'function')
      ? lib.collectOwnAgentOptions(ownResponse?.data)
      : [];
    render(lib && typeof lib.buildPlatformAgentMenu === 'function'
      ? lib.buildPlatformAgentMenu(
        unwrapItems(response.data),
        lastRoute,
        lastSkuId,
        menuLabels(),
        ownItems,
        { ownProvider: lastOwnProvider, ownModel: lastOwnModel },
      )
      : { options: [], selectedId: '', persist: false });
  }

  function refreshUi(opts) {
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
      // 打开弹窗套用默认「调用平台后端」时不展开登录表单；用户改选该方式时才展开。
      if (opts && opts.promptLogin === false) return;
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

  function syncRoute(nextRoute, opts) {
    const value = String(nextRoute || '');
    if (value === 'saas' || value === 'system') {
      if (routeMode !== 'saas' && routeMode !== 'system') {
        routeMode = value;
      }
      refreshUi(opts);
      return;
    }
    routeMode = 'direct';
    refreshUi(opts);
  }

  function parsedSelection() {
    const lib = Lib();
    const raw = String(selectEl()?.value || '').trim();
    if (lib && typeof lib.parsePlatformAgentValue === 'function' && raw) {
      return lib.parsePlatformAgentValue(raw);
    }
    return {
      routeMode: routeMode === 'system' ? 'system' : 'saas',
      systemSkuId: lastSkuId,
      ownProvider: lastOwnProvider,
      ownModel: lastOwnModel,
    };
  }

  function currentSkuId() {
    return parsedSelection().systemSkuId || lastSkuId;
  }

  function currentRouteMode() {
    return parsedSelection().routeMode;
  }

  function currentOwnProvider() {
    return parsedSelection().ownProvider || lastOwnProvider;
  }

  function currentOwnModel() {
    return parsedSelection().ownModel || lastOwnModel;
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
    currentOwnProvider, currentOwnModel,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
