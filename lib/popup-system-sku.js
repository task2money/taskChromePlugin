/**
 * Popup「调用系统智能体」后的 SKU 下拉（纯函数，无 HTTP）。
 * 仅 route=system 时显示该行；未登录只提示先登录、不展示下拉；登录后列出 SKU。
 */
(function (global) {
  'use strict';

  /**
   * @param {boolean} loggedIn
   * @param {string|null|undefined} routeMode
   * @returns {'hidden'|'login_required'|'menu'}
   */
  function systemSkuUiMode(loggedIn, routeMode) {
    if (String(routeMode || '') !== 'system') return 'hidden';
    return loggedIn ? 'menu' : 'login_required';
  }

  /**
   * @param {{hidden?:boolean,style?:{display?:string}}|null|undefined} row
   * @param {'hidden'|'login_required'|'menu'} mode
   */
  function applySystemSkuRow(row, mode) {
    if (!row) return;
    const visible = mode !== 'hidden';
    row.hidden = !visible;
    if (row.style) row.style.display = visible ? '' : 'none';
  }

  /**
   * @param {{hint?:{hidden?:boolean}|null, select?:{hidden?:boolean}|null}} els
   * @param {'hidden'|'login_required'|'menu'} mode
   */
  function applySystemSkuLoginGate(els, mode) {
    const hint = els && els.hint;
    const select = els && els.select;
    const needLogin = mode === 'login_required';
    const showMenu = mode === 'menu';
    if (hint) hint.hidden = !needLogin;
    if (select) select.hidden = !showMenu;
  }

  /**
   * @param {Array<{id?:string,name?:string}>} items
   * @param {string|null|undefined} lastSkuId
   * @returns {{ options: Array<{id:string,label:string}>, selectedId: string, persist: boolean }}
   */
  function buildSystemSkuMenu(items, lastSkuId) {
    const list = Array.isArray(items) ? items : [];
    const options = [];
    for (let i = 0; i < list.length; i += 1) {
      const id = String(list[i]?.id || '').trim();
      if (!id) continue;
      const label = String(list[i]?.name || id).trim() || id;
      options.push({ id, label });
    }
    const last = String(lastSkuId || '').trim();
    const known = options.some((item) => item.id === last);
    let selectedId = known ? last : '';
    let persist = false;
    if (!selectedId && options.length === 1) {
      selectedId = options[0].id;
      persist = true;
    }
    return { options, selectedId, persist };
  }

  const PopupSystemSkuMenu = {
    systemSkuUiMode,
    applySystemSkuRow,
    applySystemSkuLoginGate,
    buildSystemSkuMenu,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupSystemSkuMenu;
  }
  if (global) global.PopupSystemSkuMenu = PopupSystemSkuMenu;
})(typeof globalThis !== 'undefined' ? globalThis : this);
