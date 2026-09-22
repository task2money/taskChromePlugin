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
    } catch (_) { /* ignore */ }
  }

  async function savePageAdvisorLlmConfig() {
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
      await PageAdvisorLlmConfig.saveToStorage({
        apiKey: $('#popupLlmApiKey')?.value || '',
        baseUrl: $('#popupLlmBaseUrl')?.value || '',
        model: $('#popupLlmModel')?.value || '',
      });
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
    if (ui) ui.collapseLlmSettingsAfterSave(saved, llmFields(), llmToggleBtn());
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
