/**
 * Popup：本机直连调用账本的导出 / 清空（OPT-20261015-022）。
 *
 * 拆成独立文件有两个原因：
 * 1. 「直连我的 Key」的记录只存在于本机（chrome.storage.local），平台侧看不到这条
 *    链路，导出是用户能拿出「内容发去了哪些主机、用了多少 token」的唯一出口；
 *    本机记录必须同时可删——只有导出没有清空，等于替用户攒一份他处置不了的日志。
 * 2. popup/popup-llm-config.js 已接近 500 行门禁，本文件自带按钮绑定，不必再挤进去。
 *
 * 导出内容与文件名都由 lib/llm-call-ledger.js 决定（字段白名单在那里，天然不含
 * Key 与正文），这里只做 DOM 与状态提示。
 */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const Ledger = () => (typeof PageAdvisorLLMLedger !== 'undefined' ? PageAdvisorLLMLedger : null);
  const t = (key, params) => (typeof tx === 'function' ? tx(key, params) : key);

  function setStatus(text) {
    const el = $('#popupLlmStatus');
    if (el) el.textContent = text;
  }

  /** 导出本机账本为 JSON 附件；空账本不下载，直接说明为什么。 */
  async function exportLedger() {
    const ledger = Ledger();
    if (!ledger) {
      setStatus(t('popupSaveFailed'));
      return;
    }
    let entries = [];
    try {
      entries = await ledger.listCalls();
    } catch (_) {
      entries = [];
    }
    if (!entries.length) {
      setStatus(t('paLlmLedgerEmpty'));
      return;
    }
    try {
      const text = await ledger.exportJSON();
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = ledger.exportFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 释放与创建成对：只 createObjectURL 不 revoke 会在长会话里泄漏 blob。
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setStatus(t('paLlmLedgerExported', { n: entries.length }));
    } catch (_) {
      setStatus(t('paLlmLedgerExportFailed'));
    }
  }

  /** 清空本机账本（用户主动处置自己的记录）。 */
  async function clearLedger() {
    const ledger = Ledger();
    if (!ledger) {
      setStatus(t('popupSaveFailed'));
      return;
    }
    if (typeof window.confirm === 'function' && !window.confirm(t('paLlmLedgerClearConfirm'))) return;
    const ok = await ledger.clearCalls();
    setStatus(t(ok ? 'paLlmLedgerCleared' : 'paLlmLedgerExportFailed'));
  }

  function bind() {
    const exportBtn = $('#btnExportLlmCallLedger');
    // Anti-Replay-OK: ui-only local chrome.storage read + blob download, no HTTP mutation.
    if (exportBtn) exportBtn.addEventListener('click', () => { exportLedger().catch(() => {}); });
    const clearBtn = $('#btnClearLlmCallLedger');
    // Anti-Replay-OK: ui-only local chrome.storage write, no HTTP mutation.
    if (clearBtn) clearBtn.addEventListener('click', () => { clearLedger().catch(() => {}); });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.PopupLlmCallLedger = { exportLedger, clearLedger };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { exportLedger, clearLedger };
  }
})();
