/**
 * Panel Tab 3：错误列表查看（OPT-20260812-051 拆分）。
 * 依赖 window.PanelApp（panel-core.js）。
 */
(function () {
  const P = window.PanelApp;

  P.bindErrorListTab = function () {
    P.$('#btnRefreshErrorList').addEventListener('click', P.refreshErrorList);
    P.$('#btnClearErrorList').addEventListener('click', async () => {
      await P.sendMessage({ action: 'clearCapturedErrors' });
      await P.refreshErrorList();
    });
  };

  P.refreshErrorList = async function () {
    const c = P.$('#errorList');
    try {
      const r = await P.sendMessage({ action: 'getCapturedErrors' });
      const only5xx = CaptureStatus.filterBadgeCountableRequests(r?.success ? (r.data || []) : []);
      if (!only5xx.length) { c.innerHTML = '<p class="placeholder">暂无 5xx 错误请求（示数仅计 5xx）</p>'; return; }
      let h = '';
      for (const e of [...only5xx].reverse()) {
        const s = (e.url || '').length > 100 ? e.url.slice(0, 100) + '...' : e.url;
        h += `<div class="error-item">
          <div class="err-url"><span class="req-method ${e.method}">${e.method}</span><span class="err-status">${e.canceled ? 'Canceled' : e.statusCode}</span>${P.escHtml(s)}</div>
          <div class="err-meta"><span>${e.type}</span><span>${new Date(e.capturedAt).toLocaleString()}</span></div>
        </div>`;
      }
      c.innerHTML = h;
    } catch (_) { c.innerHTML = '<p class="placeholder">加载失败</p>'; }
  };
})();
