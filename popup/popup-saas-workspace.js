/** Popup：登录后在「调用平台后端」下选择 Alt+Z 默认工作空间。 */
(function () {
  const Lib = () => (typeof PopupSaasWorkspaceMenu !== 'undefined' ? PopupSaasWorkspaceMenu : null);
  const row = () => document.querySelector('#popupSaasWorkspaceRow');
  const selectEl = () => document.querySelector('#popupSaasWorkspace');
  const statusEl = () => document.querySelector('#popupSaasWorkspaceStatus');
  let suppress = false;
  let loadGen = 0;

  function clearStatus() {
    const st = statusEl();
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
    console.warn('[taskChromePlugin] popup saas workspace load failed', {
      traceId: err?.traceId || '',
    });
  }

  function persist(id) {
    if (typeof Storage === 'undefined' || typeof Storage.saveLastWorkspace !== 'function') return;
    Storage.saveLastWorkspace(id).catch((e) => {
      console.warn('[taskChromePlugin] save last workspace failed', { message: e?.message || '' });
    });
  }

  function render(menu) {
    const sel = selectEl();
    if (!sel || !menu) return;
    suppress = true;
    try {
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

  function setLoggedIn(loggedIn) {
    const lib = Lib();
    if (lib) lib.applySaasWorkspaceRow(row(), loggedIn);
    if (!loggedIn) {
      loadGen += 1;
      clearStatus();
      return;
    }
    loadMenu().catch((e) => showError(e));
  }

  function bind() {
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

  window.PopupSaasWorkspace = { setLoggedIn, loadMenu };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
