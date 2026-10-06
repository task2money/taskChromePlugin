/**
 * Popup「调用平台后端」后的工作空间下拉（纯函数，无 HTTP）。
 * 仅 route=saas 或 system 时显示该行；未登录显示「请先登录」占位；登录后选项来自工作空间列表。
 */
(function (global) {
  'use strict';

  // OPT-20261006-014: 显隐/占位/重试统一由 popup-login-gated-select.js 提供。
  const Gated = (typeof module !== 'undefined' && module.exports)
    ? require('./popup-login-gated-select.js')
    : global.LoginGatedSelect;

  /**
   * @param {boolean} loggedIn
   * @param {string|null|undefined} routeMode direct | saas | system | builtin
   * @returns {'hidden'|'login_required'|'menu'}
   */
  function saasWorkspaceUiMode(loggedIn, routeMode) {
    return Gated.loginGatedUiMode(loggedIn, routeMode, ['saas', 'system']);
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
    return Gated.applyGatedRow(row, mode);
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
