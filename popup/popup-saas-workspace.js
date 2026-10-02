/** Popup：仅在「调用平台后端」下显示工作空间；未登录为「请先登录」占位。 */
(function () {
  const Lib = () => (typeof PopupSaasWorkspaceMenu !== 'undefined' ? PopupSaasWorkspaceMenu : null);
  const row = () => document.querySelector('#popupSaasWorkspaceRow');
  const selectEl = () => document.querySelector('#popupSaasWorkspace');
  const statusEl = () => document.querySelector('#popupSaasWorkspaceStatus');
  const retryEl = () => document.querySelector('#popupSaasWorkspaceRetry');
  let suppress = false;
  let loadGen = 0;
  /** 重试的同步点击锁：置位发生在任何 await 之前，同一 tick 连点只发一次 getWorkspaces。 */
  let retrying = false;
  let loggedIn = false;
  let routeMode = 'direct';

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
    console.warn('[taskChromePlugin] popup saas workspace load failed', {
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
    if (typeof Storage === 'undefined' || typeof Storage.saveLastWorkspace !== 'function') return;
    Storage.saveLastWorkspace(id).catch((e) => {
      console.warn('[taskChromePlugin] save last workspace failed', { message: e?.message || '' });
    });
  }

  function resolveMode() {
    const lib = Lib();
    if (lib) return lib.saasWorkspaceUiMode(loggedIn, routeMode);
    if (routeMode !== 'saas') return 'hidden';
    return loggedIn ? 'menu' : 'login_required';
  }

  function applyRowVisibility(mode) {
    const lib = Lib();
    const target = row();
    if (lib) {
      lib.applySaasWorkspaceRow(target, mode);
      return;
    }
    if (!target) return;
    const visible = mode !== 'hidden';
    target.hidden = !visible;
    if (target.style) target.style.display = visible ? '' : 'none';
  }

  function renderLoginPlaceholder() {
    const sel = selectEl();
    if (!sel) return;
    suppress = true;
    try {
      sel.replaceChildren();
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = (typeof tx === 'function')
        ? tx('paSaasWorkspaceNeedLogin')
        : '-- 请先登录 --';
      sel.appendChild(empty);
      sel.value = '';
      sel.disabled = true;
    } finally {
      suppress = false;
    }
    setRetryVisible(false);
  }

  function render(menu) {
    const sel = selectEl();
    if (!sel || !menu) return;
    suppress = true;
    try {
      sel.disabled = false;
      sel.replaceChildren();
      if (!menu.options.length) {
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = tx('commonNoWorkspace');
        sel.appendChild(empty);
        sel.value = '';
        return;
      }
      if (!menu.selectedId) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = tx('commonSelectWsOption');
        sel.appendChild(placeholder);
      }
      for (const item of menu.options) {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item.label;
        sel.appendChild(opt);
      }
      sel.value = menu.selectedId || '';
    } finally {
      suppress = false;
    }
    if (menu.persist && menu.selectedId) persist(menu.selectedId);
  }

  function unwrapRows(data) {
    if (Array.isArray(data)) return data;
    return data?.results || data?.items || data?.data || [];
  }

  async function loadMenu() {
    const gen = ++loadGen;
    const sel = selectEl();
    if (sel) {
      suppress = true;
      sel.disabled = false;
      sel.replaceChildren();
      const loading = document.createElement('option');
      loading.value = '';
      loading.textContent = tx('commonLoading');
      sel.appendChild(loading);
      suppress = false;
    }
    clearStatus();
    if (typeof sendMessageWithTimeout !== 'function') return;
    let lastId = '';
    try {
      if (typeof Storage !== 'undefined' && typeof Storage.getLastWorkspace === 'function') {
        lastId = String((await Storage.getLastWorkspace()) || '');
      }
    } catch (_) { /* 无上次选择 */ }
    if (gen !== loadGen) return;
    let response;
    try {
      response = await sendMessageWithTimeout({ action: 'getWorkspaces' }, 12000);
    } catch (e) {
      if (gen !== loadGen) return;
      showError(e);
      return;
    }
    if (gen !== loadGen) return;
    if (!response || response.success === false) {
      const err = new Error(response?.error || 'getWorkspaces failed');
      if (response?.traceId) err.traceId = response.traceId;
      showError(err);
      return;
    }
    const rows = unwrapRows(response.data);
    const labels = (typeof WorkspaceList !== 'undefined' && typeof WorkspaceList.workspaceOptionLabels === 'function')
      ? WorkspaceList.workspaceOptionLabels(rows)
      : rows.map((ws) => String(ws?.name || ws?.id || ws?._id || ''));
    const lib = Lib();
    render(lib
      ? lib.buildSaasWorkspaceMenu(rows, lastId, labels)
      : { options: [], selectedId: '', persist: false });
  }

  function refreshUi() {
    const mode = resolveMode();
    applyRowVisibility(mode);
    if (mode === 'hidden') {
      loadGen += 1;
      clearStatus();
      return;
    }
    if (mode === 'login_required') {
      loadGen += 1;
      clearStatus();
      renderLoginPlaceholder();
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
    routeMode = (value === 'saas' || value === 'builtin') ? value : 'direct';
    refreshUi();
  }

  function bind() {
    const retryBtn = retryEl();
    if (retryBtn && retryBtn.dataset.saasWorkspaceRetryBound !== '1') {
      retryBtn.dataset.saasWorkspaceRetryBound = '1';
      retryBtn.addEventListener('click', retry);
    }
    const sel = selectEl();
    if (!sel || sel.dataset.saasWorkspaceBound === '1') return;
    sel.dataset.saasWorkspaceBound = '1';
    // Anti-Replay-OK: ui-only local chrome.storage write, no HTTP mutation.
    sel.addEventListener('change', () => {
      if (suppress) return;
      const id = sel.value;
      if (!id) return;
      persist(id);
    });
  }

  window.PopupSaasWorkspace = { setLoggedIn, syncRoute, loadMenu };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
