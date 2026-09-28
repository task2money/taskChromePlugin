/**
 * Popup「调用平台后端」后的工作空间下拉（纯函数，无 HTTP）。
 * 未登录不展示；登录后选项来自工作空间列表，选中值即 Alt+Z 默认工作空间。
 */
(function (global) {
  'use strict';

  function saasWorkspaceVisible(loggedIn) {
    return Boolean(loggedIn);
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

  function applySaasWorkspaceRow(row, loggedIn) {
    if (!row) return;
    const visible = saasWorkspaceVisible(loggedIn);
    row.hidden = !visible;
    if (row.style) row.style.display = visible ? '' : 'none';
  }

  const PopupSaasWorkspaceMenu = {
    saasWorkspaceVisible,
    buildSaasWorkspaceMenu,
    applySaasWorkspaceRow,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupSaasWorkspaceMenu;
  }
  if (global) global.PopupSaasWorkspaceMenu = PopupSaasWorkspaceMenu;
})(typeof globalThis !== 'undefined' ? globalThis : this);
