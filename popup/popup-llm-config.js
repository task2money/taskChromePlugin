/** Popup：自动创新直连 LLM 配置（本机 storage，无 HTTP）。 */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const Ui = () => (typeof PopupLlmSettingsUi !== 'undefined' ? PopupLlmSettingsUi : null);

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

  let routeUiReady = false;

  function selectedRouteMode() {
    const el = document.querySelector('input[name="popupLlmRoute"]:checked');
    return el && el.value === 'saas' ? 'saas' : 'direct';
  }

  function currentLlmPayload() {
    return {
      apiKey: $('#popupLlmApiKey')?.value || '',
      baseUrl: $('#popupLlmBaseUrl')?.value || '',
      model: $('#popupLlmModel')?.value || '',
      routeMode: selectedRouteMode(),
    };
  }

  async function loadPageAdvisorLlmConfig() {
    const apiKeyEl = $('#popupLlmApiKey');
    const baseEl = $('#popupLlmBaseUrl');
    const modelEl = $('#popupLlmModel');
    if (!apiKeyEl || !baseEl || !modelEl) return;
    setLlmSectionVisible(true);
    const ui = Ui();
    if (ui) ui.setLlmSettingsExpanded(llmFields(), llmToggleBtn(), false);
    if (typeof PageAdvisorLlmConfig === 'undefined') return;
    try {
      const cfg = await PageAdvisorLlmConfig.loadFromStorage();
      apiKeyEl.value = cfg.apiKey || '';
      baseEl.value = cfg.baseUrl || '';
      modelEl.value = cfg.model || '';
      const route = (typeof PageAdvisorLlmConfig.resolveRoute === 'function')
        ? PageAdvisorLlmConfig.resolveRoute(cfg)
        : 'saas';
      const direct = $('#popupLlmRouteDirect');
      const saas = $('#popupLlmRouteSaas');
      if (direct) direct.checked = route === 'direct';
      if (saas) saas.checked = route === 'saas';
      routeUiReady = true;
    } catch (_) { /* ignore */ }
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
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    }
    let saved = false;
    try {
      await PageAdvisorLlmConfig.saveToStorage(currentLlmPayload());
      if (status) status.textContent = tx('paLlmSaved');
      saved = true;
    } catch (e) {
      if (status) status.textContent = e?.message || tx('popupSaveFailed');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
      }
    }
    if (collapse && ui) ui.collapseLlmSettingsAfterSave(saved, llmFields(), llmToggleBtn());
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
        if (!routeUiReady) return;
        savePageAdvisorLlmConfig({ collapse: false }).catch(() => {});
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
