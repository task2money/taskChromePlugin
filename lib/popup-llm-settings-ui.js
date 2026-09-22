/**
 * Popup Auto-innovate：API Key 设置区展开/收起（纯 DOM 属性，无 HTTP）。
 */
(function (global) {
  'use strict';

  function isLlmSettingsExpanded(fieldsEl) {
    if (!fieldsEl || !fieldsEl.style) return false;
    return fieldsEl.style.display === 'block';
  }

  function setLlmSettingsExpanded(fieldsEl, toggleBtn, expanded) {
    const open = Boolean(expanded);
    if (fieldsEl) {
      fieldsEl.style.display = open ? 'block' : 'none';
      fieldsEl.hidden = !open;
    }
    if (toggleBtn && typeof toggleBtn.setAttribute === 'function') {
      toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }

  function toggleLlmSettingsExpanded(fieldsEl, toggleBtn) {
    const next = !isLlmSettingsExpanded(fieldsEl);
    setLlmSettingsExpanded(fieldsEl, toggleBtn, next);
    return next;
  }

  function collapseLlmSettingsAfterSave(ok, fieldsEl, toggleBtn) {
    if (ok) setLlmSettingsExpanded(fieldsEl, toggleBtn, false);
  }

  const PopupLlmSettingsUi = {
    isLlmSettingsExpanded,
    setLlmSettingsExpanded,
    toggleLlmSettingsExpanded,
    collapseLlmSettingsAfterSave,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupLlmSettingsUi;
  }
  if (global) global.PopupLlmSettingsUi = PopupLlmSettingsUi;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
