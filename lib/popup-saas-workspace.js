/**
 * Popup「调用平台后端」后的工作空间下拉（纯函数，无 HTTP）。
 * 仅 route=saas 时显示该行；未登录显示「请先登录」占位；登录后选项来自工作空间列表。
 */
(function (global) {
  'use strict';

  /**
   * @param {boolean} loggedIn
   * @param {string|null|undefined} routeMode direct | saas | builtin
   * @returns {'hidden'|'login_required'|'menu'}
   */
  function saasWorkspaceUiMode(loggedIn, routeMode) {
    if (String(routeMode || '') !== 'saas') return 'hidden';
    return loggedIn ? 'menu' : 'login_required';
  }

  /** 行是否可见（含未登录占位）。 */
  function saasWorkspaceVisible(loggedIn, routeMode) {
    return saasWorkspaceUiMode(loggedIn, routeMode) !== 'hidden';
  }

  /**
   * @param {Array<{id?:string,_id?:string}>} workspaces
   * @param {string|null|undefined} lastWorkspaceId
   * @param {string[]} labels 与 workspaces 同序
   * @returns {{ options: Array<{id:string,label:string}>, selectedId: string, persist: boolean }}
   */
  function buildSaasWorkspaceMenu(workspaces, lastWorkspaceId, labels) {
    const list = Array.isArray(workspaces) ? workspaces : [];
    const labelList = Array.isArray(labels) ? labels : [];
    const options = [];
    for (let i = 0; i < list.length; i += 1) {
      const id = String(list[i]?.id || list[i]?._id || '').trim();
      if (!id) continue;
      options.push({ id, label: String(labelList[i] || id) });
    }
    const last = String(lastWorkspaceId || '').trim();
    const known = options.some((item) => item.id === last);
    let selectedId = known ? last : '';
    let persist = false;
    if (!selectedId && options.length === 1) {
      selectedId = options[0].id;
      persist = true;
    }
    return { options, selectedId, persist };
  }

  /**
   * @param {{hidden?:boolean,style?:{display?:string}}|null|undefined} row
   * @param {'hidden'|'login_required'|'menu'} mode
   */
  function applySaasWorkspaceRow(row, mode) {
    if (!row) return;
    const visible = mode !== 'hidden';
    row.hidden = !visible;
    if (row.style) row.style.display = visible ? '' : 'none';
  }

  const PopupSaasWorkspaceMenu = {
    saasWorkspaceUiMode,
    saasWorkspaceVisible,
    buildSaasWorkspaceMenu,
    applySaasWorkspaceRow,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupSaasWorkspaceMenu;
  }
  if (global) global.PopupSaasWorkspaceMenu = PopupSaasWorkspaceMenu;
})(typeof globalThis !== 'undefined' ? globalThis : this);
