/** 建议送达目标单选（本机 storage，无 HTTP）。 */
(function bindPageAdvisorDeliveryRadios() {
  'use strict';
  const field = document.getElementById('popupDeliveryTargetField');
  if (!field) return;
  const Delivery = globalThis.PageAdvisorDelivery;
  const key = Delivery ? Delivery.STORAGE_KEY : 'pageAdvisorDeliveryTarget';
  function applyChecked(raw) {
    const t = Delivery ? Delivery.normalizeTarget(raw) : 'task_description';
    const input = field.querySelector(`input[name="pageAdvisorDeliveryTarget"][value="${t}"]`);
    if (input) input.checked = true;
  }
  try {
    chrome.storage.local.get([key], (r) => {
      applyChecked(r && r[key]);
    });
  } catch (_) {
    applyChecked('');
  }
  field.addEventListener('change', (ev) => {
    const el = ev.target;
    if (!el || el.name !== 'pageAdvisorDeliveryTarget') return;
    // Anti-Replay-OK: ui-only — 覆盖本机送达目标，无写接口
    const t = Delivery ? Delivery.normalizeTarget(el.value) : 'task_description';
    try {
      chrome.storage.local.set({ [key]: t });
    } catch (_) { /* ignore */ }
  });
})();
