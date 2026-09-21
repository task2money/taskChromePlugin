/** Popup：自动创新直连 LLM 配置（本机 storage，无 HTTP）。 */
(function () {
  const $ = (sel) => document.querySelector(sel);

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
    if (typeof PageAdvisorLlmConfig === 'undefined') {
      if (status) status.textContent = tx('popupSaveFailed');
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    }
    try {
      await PageAdvisorLlmConfig.saveToStorage({
        apiKey: $('#popupLlmApiKey')?.value || '',
        baseUrl: $('#popupLlmBaseUrl')?.value || '',
        model: $('#popupLlmModel')?.value || '',
      });
      if (status) status.textContent = tx('paLlmSaved');
    } catch (e) {
      if (status) status.textContent = e?.message || tx('popupSaveFailed');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
      }
    }
  }

  function bindPageAdvisorLlmEvents() {
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
