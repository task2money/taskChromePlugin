/**
 * Popup「调用平台后端」后的智能体下拉（纯函数，无 HTTP）。
 * 仅 route=saas|system 时显示；未登录只提示先登录、不展示下拉；
 * 登录后列出自有智能体 + 系统智能体 SKU。
 */
(function (global) {
  'use strict';

  const OWN_VALUE = 'own';

  /**
   * @param {boolean} loggedIn
   * @param {string|null|undefined} routeMode
   * @returns {'hidden'|'login_required'|'menu'}
   */
  function systemSkuUiMode(loggedIn, routeMode) {
    const route = String(routeMode || '');
    if (route !== 'saas' && route !== 'system') return 'hidden';
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
   * @param {string|null|undefined} routeMode
   * @param {string|null|undefined} skuId
   */
  function encodePlatformAgentValue(routeMode, skuId) {
    const sku = String(skuId || '').trim();
    if (String(routeMode || '') === 'system' && sku) return `system:${sku}`;
    return OWN_VALUE;
  }

  /**
   * @param {string|null|undefined} value
   * @returns {{ routeMode: 'saas'|'system', systemSkuId: string }}
   */
  function parsePlatformAgentValue(value) {
    const raw = String(value || '').trim();
    if (raw.startsWith('system:')) {
      const sku = raw.slice('system:'.length).trim();
      if (sku) return { routeMode: 'system', systemSkuId: sku };
    }
    return { routeMode: 'saas', systemSkuId: '' };
  }

  /**
   * @param {Array<{id?:string,name?:string}>} items
   * @param {string|null|undefined} lastSkuId
   * @returns {{ options: Array<{id:string,label:string}>, selectedId: string, persist: boolean }}
   */
  function buildSystemSkuMenu(items, lastSkuId) {
    return buildPlatformAgentMenu(items, lastSkuId ? 'system' : 'saas', lastSkuId, {});
  }

  /**
   * @param {Array<{id?:string,name?:string}>} items
   * @param {string|null|undefined} lastRoute
   * @param {string|null|undefined} lastSkuId
   * @param {{own?:string,ownGroup?:string,systemGroup?:string}} labels
   */
  function buildPlatformAgentMenu(items, lastRoute, lastSkuId, labels) {
    const ownLabel = String((labels && labels.own) || '自有智能体').trim() || '自有智能体';
    const ownGroup = String((labels && labels.ownGroup) || '自有智能体').trim() || '自有智能体';
    const systemGroup = String((labels && labels.systemGroup) || '系统智能体').trim() || '系统智能体';
    const options = [{ id: OWN_VALUE, label: ownLabel, group: ownGroup }];
    const list = Array.isArray(items) ? items : [];
    for (let i = 0; i < list.length; i += 1) {
      const id = String(list[i]?.id || '').trim();
      if (!id) continue;
      const label = String(list[i]?.name || id).trim() || id;
      options.push({ id: `system:${id}`, label, group: systemGroup });
    }
    const wanted = encodePlatformAgentValue(lastRoute, lastSkuId);
    const known = options.some((item) => item.id === wanted);
    const selectedId = known ? wanted : OWN_VALUE;
    return { options, selectedId, persist: false };
  }

  const PopupSystemSkuMenu = {
    OWN_VALUE,
    systemSkuUiMode,
    applySystemSkuRow,
    applySystemSkuLoginGate,
    buildSystemSkuMenu,
    buildPlatformAgentMenu,
    encodePlatformAgentValue,
    parsePlatformAgentValue,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupSystemSkuMenu;
  }
  if (global) global.PopupSystemSkuMenu = PopupSystemSkuMenu;
})(typeof globalThis !== 'undefined' ? globalThis : this);
