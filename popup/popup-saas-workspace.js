/** Popup：网页优化设置区只保留工作空间；仅登录后显示，未登录整块隐藏。 */
(function () {
  const Lib = () => (typeof PopupSaasWorkspaceMenu !== 'undefined' ? PopupSaasWorkspaceMenu : null);
  const sectionEl = () => document.querySelector('#pageAdvisorWorkspaceSection');
  const selectEl = () => document.querySelector('#popupPageAdvisorWorkspace');
  const statusEl = () => document.querySelector('#popupPageAdvisorWorkspaceStatus');
  const retryEl = () => document.querySelector('#popupPageAdvisorWorkspaceRetry');
  let suppress = false;
  let loadGen = 0;
  let loggedIn = false;

  // OPT-20261006-014: 重试按钮/状态条/同步点击锁统一走共用 loginGatedSelect 控制器。
  const gated = (typeof LoginGatedSelect !== 'undefined')
    ? LoginGatedSelect.createRetryController({
      retryEl,
      statusEl,
      warnLabel: 'popup page advisor workspace',
      load: () => loadMenu(),
    })
    : null;

  function clearStatus() { if (gated) gated.clearStatus(); }

  function showError(err) { if (gated) gated.showError(err); }

  function retry() { if (gated) gated.retry(); }

  function persist(id, opts) {
    if (typeof Storage === 'undefined' || typeof Storage.saveLastWorkspace !== 'function') return;
    Storage.saveLastWorkspace(id, opts).catch((e) => {
      console.warn('[taskChromePlugin] save last workspace failed', { message: e?.message || '' });
    });
  }

  function resolveMode() {
    const lib = Lib();
    if (lib && typeof lib.pageAdvisorWorkspaceUiMode === 'function') {
      return lib.pageAdvisorWorkspaceUiMode(loggedIn);
    }
    return loggedIn ? 'menu' : 'hidden';
  }

  function applySectionVisibility(mode) {
    const lib = Lib();
    const target = sectionEl();
    if (lib && typeof lib.applySaasWorkspaceRow === 'function') {
      lib.applySaasWorkspaceRow(target, mode);
      return;
    }
    if (!target) return;
    const visible = mode !== 'hidden';
    target.hidden = !visible;
    if (target.style) target.style.display = visible ? '' : 'none';
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
    // 自动选中（平台默认工作空间 / 唯一空间）记 auto，手动切换记手选（见 change 处理器）。
    if (menu.persist && menu.selectedId) {
      persist(menu.selectedId, { manual: menu.source === 'manual' });
      console.info('[taskChromePlugin] page advisor workspace auto-selected', {
        source: menu.source, workspaceId: menu.selectedId, options: menu.options.length,
      });
    }
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
    let manual = true;
    try {
      if (typeof Storage !== 'undefined' && typeof Storage.getLastWorkspace === 'function') {
        lastId = String((await Storage.getLastWorkspace()) || '');
      }
      // 缺标志（null / 旧版 Storage mock）视为手选：既有用户的选择不被平台默认覆盖。
      if (typeof Storage !== 'undefined' && typeof Storage.getLastWorkspaceManual === 'function') {
        const flag = await Storage.getLastWorkspaceManual();
        if (typeof flag === 'boolean') manual = flag;
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
      ? lib.buildSaasWorkspaceMenu(rows, lastId, labels, { manual })
      : { options: [], selectedId: '', persist: false });
  }

  function refreshUi() {
    const mode = resolveMode();
    applySectionVisibility(mode);
    if (mode === 'hidden') {
      // 未登录：丢弃在途加载结果并清掉上一次的失败态，整区不可见。
      loadGen += 1;
      clearStatus();
      return;
    }
    loadMenu().catch((e) => showError(e));
  }

  /** 登录态入口（页面/登录流程共用；setLoggedIn 为既有调用方保留）。 */
  function syncLoggedIn(next) {
    loggedIn = Boolean(next);
    refreshUi();
  }

  function bind() {
    const retryBtn = retryEl();
    if (retryBtn && retryBtn.dataset.pageAdvisorWorkspaceRetryBound !== '1') {
      retryBtn.dataset.pageAdvisorWorkspaceRetryBound = '1';
      retryBtn.addEventListener('click', retry);
    }
    const sel = selectEl();
    if (!sel || sel.dataset.pageAdvisorWorkspaceBound === '1') return;
    sel.dataset.pageAdvisorWorkspaceBound = '1';
    // Anti-Replay-OK: ui-only local chrome.storage write, no HTTP mutation.
    sel.addEventListener('change', () => {
      if (suppress) return;
      const id = sel.value;
      if (!id) return;
      // 用户手动切换：记手选，之后平台默认不再覆盖（除非该工作空间消失）。
      persist(id, { manual: true });
    });
  }

  window.PopupSaasWorkspace = {
    syncLoggedIn,
    // popup-auth.js 的登录流程仍调用 setLoggedIn；两者同一实现。
    setLoggedIn: syncLoggedIn,
    loadMenu,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
