/**
 * 登录门闩下拉共用模块（OPT-20261006-014，纯函数，无 HTTP）。
 *
 * 「调用平台后端」后的工作空间下拉与「调用系统智能体」SKU 下拉此前各有一套
 * 显隐 / 请先登录占位 / 失败重试实现，重试的同步点击锁、traceId 回填、占位文案
 * 会再分叉。这里抽出单一来源，两处只保留数据源差异。
 */
(function (global) {
  'use strict';

  /** 只在这两种路由下暴露平台后端相关的登录门闩下拉。 */
  const DEFAULT_ALLOWED_ROUTES = ['saas', 'system'];

  /**
   * @param {boolean} loggedIn
   * @param {string|null|undefined} routeMode direct | saas | system | builtin
   * @param {string[]} [allowedRoutes] 默认 ['saas','system']
   * @returns {'hidden'|'login_required'|'menu'}
   */
  function loginGatedUiMode(loggedIn, routeMode, allowedRoutes) {
    const route = String(routeMode || '');
    const allowed = Array.isArray(allowedRoutes) && allowedRoutes.length
      ? allowedRoutes
      : DEFAULT_ALLOWED_ROUTES;
    if (allowed.indexOf(route) < 0) return 'hidden';
    return loggedIn ? 'menu' : 'login_required';
  }

  /**
   * 行可见性（含未登录占位行）。
   * @param {{hidden?:boolean,style?:{display?:string}}|null|undefined} row
   * @param {'hidden'|'login_required'|'menu'} mode
   */
  function applyGatedRow(row, mode) {
    if (!row) return;
    const visible = mode !== 'hidden';
    row.hidden = !visible;
    if (row.style) row.style.display = visible ? '' : 'none';
  }

  /**
   * 提示态切换：login_required 显提示隐藏 select，menu 相反。
   * @param {{hint?:object|null,select?:object|null}} els
   * @param {'hidden'|'login_required'|'menu'} mode
   */
  function applyLoginGate(els, mode) {
    const hint = els && els.hint;
    const select = els && els.select;
    const needLogin = mode === 'login_required';
    const showMenu = mode === 'menu';
    if (hint) hint.hidden = !needLogin;
    if (select) select.hidden = !showMenu;
  }

  /**
   * 失败重试控制器：状态条文案 + 重试按钮显隐 + 同步点击锁（同 tick 连点只发一次）。
   * @param {{
   *   retryEl: () => {hidden?:boolean,disabled?:boolean}|null,
   *   statusEl: () => {textContent?:string}|null,
   *   warnLabel: string,
   *   load: () => Promise<any>,
   * }} opts
   */
  function createRetryController(opts) {
    const o = opts || {};
    const retryEl = typeof o.retryEl === 'function' ? o.retryEl : () => null;
    const statusEl = typeof o.statusEl === 'function' ? o.statusEl : () => null;
    const warnLabel = String(o.warnLabel || 'popup gated select');
    const load = typeof o.load === 'function' ? o.load : () => Promise.resolve();
    /** 重试的同步点击锁：置位发生在任何 await 之前，同一 tick 连点只发一次。 */
    let retrying = false;

    function setRetryVisible(visible) {
      const btn = retryEl();
      if (!btn) return;
      btn.hidden = !visible;
      btn.disabled = false;
    }

    function clearStatus() {
      const st = statusEl();
      setRetryVisible(false);
      if (!st) return;
      st.textContent = '';
      if (typeof global.setDataTraceId === 'function') global.setDataTraceId(st, '');
    }

    function showError(err) {
      const st = statusEl();
      if (st) {
        const detail = err && err.message || '';
        st.textContent = (typeof global.tx === 'function')
          ? global.tx('commonLoadFailed', { msg: detail })
          : detail;
        if (typeof global.setDataTraceId === 'function') global.setDataTraceId(st, err);
      }
      setRetryVisible(true);
      console.warn(`[taskChromePlugin] ${warnLabel} load failed`, {
        traceId: err && err.traceId || '',
      });
    }

    function retry() {
      if (retrying) return;
      retrying = true;
      const btn = retryEl();
      if (btn) btn.disabled = true;
      Promise.resolve()
        .then(() => load())
        .catch((e) => showError(e))
        .then(() => {
          retrying = false;
          const b = retryEl();
          if (b) b.disabled = false;
        });
    }

    return { retry, showError, clearStatus, setRetryVisible };
  }

  const LoginGatedSelect = {
    DEFAULT_ALLOWED_ROUTES,
    loginGatedUiMode,
    applyGatedRow,
    applyLoginGate,
    createRetryController,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LoginGatedSelect;
  }
  if (global) global.LoginGatedSelect = LoginGatedSelect;
})(typeof globalThis !== 'undefined' ? globalThis : this);
