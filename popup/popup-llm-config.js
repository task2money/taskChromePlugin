/** Popup：自动创新直连 LLM 配置（本机 storage，无 HTTP）。 */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const Ui = () => (typeof PopupLlmSettingsUi !== 'undefined' ? PopupLlmSettingsUi : null);
  let routeUiReady = false;
  let suppressProfileChange = false;
  let lastCfg = null;

  function llmFields() {
    return $('#pageAdvisorLlmFields');
  }

  function llmToggleBtn() {
    return $('#btnToggleLlmSettings');
  }

  function setLlmSectionVisible(visible) {
    const sec = $('#pageAdvisorLlmSection');
    if (sec) sec.style.display = visible ? 'block' : 'none';
  }

  function selectedRouteMode() {
    const el = document.querySelector('input[name="popupLlmRoute"]:checked');
    return el && el.value === 'saas' ? 'saas' : 'direct';
  }

  function syncProfileRow() {
    const row = $('#popupLlmProfileRow');
    if (!row) return;
    const direct = selectedRouteMode() === 'direct';
    row.hidden = !direct;
    row.style.display = direct ? '' : 'none';
  }

  function profileErrorText(err) {
    const code = err && err.code;
    if (code === 'profile_limit') return tx('paLlmProfileLimit');
    if (code === 'profile_incomplete') return tx('paLlmProfileNeedFields');
    if (code === 'profile_not_found') return tx('paLlmProfileMissing');
    return (err && err.message) || tx('popupSaveFailed');
  }

  function fillProfileSelect(profiles, activeId) {
    const sel = $('#popupLlmProfileSelect');
    if (!sel) return;
    const unnamed = tx('paLlmProfileUnnamed');
    const labelOf = (typeof PageAdvisorLlmConfig !== 'undefined' && PageAdvisorLlmConfig.profileOptionLabel)
      ? (p) => PageAdvisorLlmConfig.profileOptionLabel(p, unnamed)
      : (p) => p.label || p.model || unnamed;
    suppressProfileChange = true;
    try {
      sel.replaceChildren();
      for (const profile of profiles || []) {
        const opt = document.createElement('option');
        opt.value = profile.id;
        opt.textContent = labelOf(profile);
        sel.appendChild(opt);
      }
      const created = document.createElement('option');
      created.value = '';
      created.textContent = tx('paLlmProfileNew');
      sel.appendChild(created);
      const wanted = activeId || '';
      sel.value = [...sel.options].some((opt) => opt.value === wanted) ? wanted : '';
    } finally {
      suppressProfileChange = false;
    }
  }

  function applyLoadedConfig(cfg, opts) {
    const draftNew = Boolean(opts && opts.draftNew);
    const apiKeyEl = $('#popupLlmApiKey');
    const baseEl = $('#popupLlmBaseUrl');
    const modelEl = $('#popupLlmModel');
    const nameEl = $('#popupLlmProfileName');
    if (apiKeyEl) apiKeyEl.value = draftNew ? '' : (cfg?.apiKey || '');
    if (baseEl) baseEl.value = draftNew ? '' : (cfg?.baseUrl || '');
    if (modelEl) modelEl.value = draftNew ? '' : (cfg?.model || '');
    if (nameEl) nameEl.value = draftNew ? '' : (cfg?.profileLabel || '');
    const route = (typeof PageAdvisorLlmConfig !== 'undefined' && typeof PageAdvisorLlmConfig.resolveRoute === 'function')
      ? PageAdvisorLlmConfig.resolveRoute(cfg || {})
      : 'direct';
    const direct = $('#popupLlmRouteDirect');
    const saas = $('#popupLlmRouteSaas');
    if (direct) direct.checked = route === 'direct';
    if (saas) saas.checked = route === 'saas';
    fillProfileSelect(cfg?.profiles || [], draftNew ? '' : cfg?.activeProfileId);
    const del = $('#btnDeleteLlmProfile');
    if (del) del.hidden = draftNew || !cfg?.activeProfileId;
    syncProfileRow();
  }

  function currentLlmPayload(opts) {
    const selected = $('#popupLlmProfileSelect')?.value || '';
    const action = (opts && opts.profileAction)
      || (selected ? 'update' : 'create');
    return {
      apiKey: $('#popupLlmApiKey')?.value || '',
      baseUrl: $('#popupLlmBaseUrl')?.value || '',
      model: $('#popupLlmModel')?.value || '',
      routeMode: selectedRouteMode(),
      profileLabel: $('#popupLlmProfileName')?.value || '',
      profileId: (opts && opts.profileId) || selected,
      profileAction: action,
    };
  }

  function currentDraftPayload() {
    return {
      profileId: $('#popupLlmProfileSelect')?.value || '',
      label: $('#popupLlmProfileName')?.value || '',
      apiKey: $('#popupLlmApiKey')?.value || '',
      baseUrl: $('#popupLlmBaseUrl')?.value || '',
      model: $('#popupLlmModel')?.value || '',
    };
  }

  function persistLlmDraft() {
    if (typeof PageAdvisorLlmConfig === 'undefined' || typeof PageAdvisorLlmConfig.saveDraftToStorage !== 'function') {
      return Promise.resolve();
    }
    return PageAdvisorLlmConfig.saveDraftToStorage(currentDraftPayload());
  }

  function clearLlmDraft() {
    if (typeof PageAdvisorLlmConfig === 'undefined' || typeof PageAdvisorLlmConfig.clearDraftFromStorage !== 'function') {
      return Promise.resolve();
    }
    return PageAdvisorLlmConfig.clearDraftFromStorage();
  }

  function overlayDraft(draft) {
    const apiKeyEl = $('#popupLlmApiKey');
    const baseEl = $('#popupLlmBaseUrl');
    const modelEl = $('#popupLlmModel');
    const nameEl = $('#popupLlmProfileName');
    if (apiKeyEl) apiKeyEl.value = draft?.apiKey || '';
    if (baseEl) baseEl.value = draft?.baseUrl || '';
    if (modelEl) modelEl.value = draft?.model || '';
    if (nameEl) nameEl.value = draft?.label || '';
    const sel = $('#popupLlmProfileSelect');
    if (!sel) return;
    const wanted = draft?.profileId || '';
    suppressProfileChange = true;
    try {
      sel.value = [...sel.options].some((opt) => opt.value === wanted) ? wanted : '';
    } finally {
      suppressProfileChange = false;
    }
    const del = $('#btnDeleteLlmProfile');
    if (del) del.hidden = !sel.value;
  }

  async function loadPageAdvisorLlmConfig() {
    const apiKeyEl = $('#popupLlmApiKey');
    const baseEl = $('#popupLlmBaseUrl');
    const modelEl = $('#popupLlmModel');
    if (!apiKeyEl || !baseEl || !modelEl) return;
    setLlmSectionVisible(true);
    const ui = Ui();
    if (typeof PageAdvisorLlmConfig === 'undefined') {
      if (ui) ui.setLlmSettingsExpanded(llmFields(), llmToggleBtn(), false);
      return;
    }
    try {
      const cfg = await PageAdvisorLlmConfig.loadFromStorage();
      lastCfg = cfg;
      const draft = await PageAdvisorLlmConfig.loadDraftFromStorage();
      const restore = PageAdvisorLlmConfig.shouldRestoreDraft(draft, cfg);
      applyLoadedConfig(cfg);
      if (restore) overlayDraft(draft);
      if (ui) ui.setLlmSettingsExpanded(llmFields(), llmToggleBtn(), restore);
      routeUiReady = true;
    } catch (_) { /* ignore */ }
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = Boolean(busy);
    if (busy) btn.setAttribute('aria-busy', 'true');
    else btn.removeAttribute('aria-busy');
  }

  async function savePageAdvisorLlmConfig(opts) {
    const collapse = !opts || opts.collapse !== false;
    const status = $('#popupLlmStatus');
    const btn = $('#btnSaveLlmConfig');
    const ui = Ui();
    if (typeof PageAdvisorLlmConfig === 'undefined') {
      if (status) status.textContent = tx('popupSaveFailed');
      if (ui) ui.collapseLlmSettingsAfterSave(false, llmFields(), llmToggleBtn());
      return;
    }
    setBusy(btn, true);
    let saved = false;
    try {
      const next = await PageAdvisorLlmConfig.saveToStorage(currentLlmPayload(opts));
      lastCfg = next;
      if (!(opts && opts.profileAction === 'route-only')) await clearLlmDraft();
      applyLoadedConfig(next);
      if (status) {
        status.textContent = opts && opts.profileAction === 'delete'
          ? tx('paLlmProfileDeleted')
          : tx('paLlmSaved');
      }
      saved = true;
    } catch (e) {
      if (status) status.textContent = profileErrorText(e);
    } finally {
      setBusy(btn, false);
    }
    if (collapse && ui) ui.collapseLlmSettingsAfterSave(saved, llmFields(), llmToggleBtn());
  }

  async function onProfileChanged() {
    if (suppressProfileChange || !routeUiReady) return;
    const sel = $('#popupLlmProfileSelect');
    const status = $('#popupLlmStatus');
    if (!sel) return;
    const id = sel.value;
    await clearLlmDraft();
    if (!id) {
      applyLoadedConfig(lastCfg || {}, { draftNew: true });
      if (status) status.textContent = tx('paLlmProfileDraft');
      return;
    }
    if (typeof PageAdvisorLlmConfig === 'undefined' || typeof PageAdvisorLlmConfig.activateProfile !== 'function') {
      return;
    }
    setBusy(sel, true);
    try {
      const next = await PageAdvisorLlmConfig.activateProfile(id);
      lastCfg = next;
      applyLoadedConfig(next);
      const name = PageAdvisorLlmConfig.profileOptionLabel(
        (next.profiles || []).find((p) => p.id === next.activeProfileId) || next,
        tx('paLlmProfileUnnamed'),
      );
      if (status) status.textContent = tx('paLlmProfileSwitched', { name });
    } catch (e) {
      if (status) status.textContent = profileErrorText(e);
      if (lastCfg) applyLoadedConfig(lastCfg);
    } finally {
      setBusy(sel, false);
    }
  }

  function bindPageAdvisorLlmEvents() {
    const toggle = llmToggleBtn();
    const ui = Ui();
    // Anti-Replay-OK: ui-only expand/collapse of local settings, no HTTP mutation.
    if (toggle && ui) {
      toggle.addEventListener('click', () => {
        ui.toggleLlmSettingsExpanded(llmFields(), toggle);
      });
    }
    const btn = $('#btnSaveLlmConfig');
    // Anti-Replay-OK: ui-only local chrome.storage write, no HTTP mutation.
    if (btn) btn.addEventListener('click', () => { savePageAdvisorLlmConfig().catch(() => {}); });
    const routeField = $('#popupLlmRouteField');
    // Anti-Replay-OK: ui-only local chrome.storage write, no HTTP mutation.
    if (routeField) {
      routeField.addEventListener('change', () => {
        syncProfileRow();
        if (!routeUiReady) return;
        savePageAdvisorLlmConfig({ collapse: false, profileAction: 'route-only' }).catch(() => {});
      });
    }
    const sel = $('#popupLlmProfileSelect');
    // Anti-Replay-OK: ui-only local chrome.storage write, no HTTP mutation.
    if (sel) sel.addEventListener('change', () => { onProfileChanged().catch(() => {}); });
    for (const id of ['#popupLlmProfileName', '#popupLlmApiKey', '#popupLlmBaseUrl', '#popupLlmModel']) {
      const el = $(id);
      if (!el) continue;
      // Anti-Replay-OK: ui-only local chrome.storage draft, no HTTP mutation.
      el.addEventListener('input', () => { persistLlmDraft().catch(() => {}); });
    }
    window.addEventListener('pagehide', () => {
      if (!routeUiReady) return;
      persistLlmDraft().catch(() => {});
    });
    const del = $('#btnDeleteLlmProfile');
    // Anti-Replay-OK: ui-only local chrome.storage write, no HTTP mutation.
    if (del) {
      del.addEventListener('click', () => {
        const id = $('#popupLlmProfileSelect')?.value || '';
        if (!id) return;
        if (typeof window.confirm === 'function' && !window.confirm(tx('paLlmProfileDeleteConfirm'))) return;
        savePageAdvisorLlmConfig({ collapse: false, profileAction: 'delete', profileId: id }).catch(() => {});
      });
    }
  }

  window.PopupPageAdvisorLlm = {
    loadPageAdvisorLlmConfig,
    setLlmSectionVisible,
    bindPageAdvisorLlmEvents,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPageAdvisorLlmEvents);
  } else {
    bindPageAdvisorLlmEvents();
  }
})();
