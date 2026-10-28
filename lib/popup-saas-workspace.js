/**
 * Popup 网页优化设置区的工作空间下拉（纯函数，无 HTTP）。
 * 仅登录后显示该区；登录后选项来自工作空间列表，
 * 未手选过时自动选中平台默认工作空间（is_default，见 pickPlatformDefaultWorkspaceId）。
 */
(function (global) {
  'use strict';

  // OPT-20261006-014: 显隐/占位/重试统一由 popup-login-gated-select.js 提供。
  const Gated = (typeof module !== 'undefined' && module.exports)
    ? require('./popup-login-gated-select.js')
    : global.LoginGatedSelect;

  /**
   * 设置区显隐只由登录态决定（调用方式已删除）：未登录整块隐藏，登录后显示菜单。
   * @param {boolean} loggedIn
   * @returns {'hidden'|'menu'}
   */
  function pageAdvisorWorkspaceUiMode(loggedIn) {
    return loggedIn ? 'menu' : 'hidden';
  }

  /** 区是否可见。 */
  function saasWorkspaceVisible(loggedIn) {
    return pageAdvisorWorkspaceUiMode(loggedIn) !== 'hidden';
  }

  /** 后端布尔标志容错：true / 1 / '1' / 'true' 均视为真。 */
  function truthyFlag(value) {
    return value === true || value === 1 || value === '1' || value === 'true';
  }

  /**
   * 平台默认工作空间：工作空间列表里 is_default 为真的那一个。
   * 用户属于多个租户时每租户各有一个默认，优先 is_current（当前所在租户）。
   * @param {Array<{id?:string,_id?:string,is_default?:unknown,is_current?:unknown}>} workspaces
   * @returns {string} 默认工作空间 id；无则为空串
   */
  function pickPlatformDefaultWorkspaceId(workspaces) {
    const list = Array.isArray(workspaces) ? workspaces : [];
    let fallback = '';
    for (const ws of list) {
      const id = String(ws?.id || ws?._id || '').trim();
      if (!id || !truthyFlag(ws?.is_default)) continue;
      if (truthyFlag(ws?.is_current)) return id;
      if (!fallback) fallback = id;
    }
    return fallback;
  }

  /**
   * @param {Array<{id?:string,_id?:string,is_default?:unknown,is_current?:unknown}>} workspaces
   * @param {string|null|undefined} lastWorkspaceId
   * @param {string[]} labels 与 workspaces 同序
   * @param {{ manual?: boolean }} [opts] manual=false 表示 lastWorkspaceId 是插件自动选中的
   *   （可被平台默认覆盖）；缺省视为用户手选，保持既有行为。
   * @returns {{ options: Array<{id:string,label:string}>, selectedId: string, persist: boolean,
   *   source: 'manual'|'default'|'last'|'single'|'' }}
   */
  function buildSaasWorkspaceMenu(workspaces, lastWorkspaceId, labels, opts) {
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
    const manual = opts?.manual !== false;
    let selectedId = '';
    let source = '';
    if (known && manual) {
      selectedId = last;
      source = 'manual';
    }
    if (!selectedId) {
      const def = pickPlatformDefaultWorkspaceId(list);
      if (def && options.some((item) => item.id === def)) {
        selectedId = def;
        source = 'default';
      }
    }
    if (!selectedId && known) {
      selectedId = last;
      source = 'last';
    }
    if (!selectedId && options.length === 1) {
      selectedId = options[0].id;
      source = 'single';
    }
    return { options, selectedId, persist: Boolean(selectedId) && selectedId !== last, source };
  }

  /**
   * @param {{hidden?:boolean,style?:{display?:string}}|null|undefined} row
   * @param {'hidden'|'login_required'|'menu'} mode
   */
  function applySaasWorkspaceRow(row, mode) {
    return Gated.applyGatedRow(row, mode);
  }

  const PopupSaasWorkspaceMenu = {
    pageAdvisorWorkspaceUiMode,
    saasWorkspaceVisible,
    buildSaasWorkspaceMenu,
    pickPlatformDefaultWorkspaceId,
    applySaasWorkspaceRow,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupSaasWorkspaceMenu;
  }
  if (global) global.PopupSaasWorkspaceMenu = PopupSaasWorkspaceMenu;
})(typeof globalThis !== 'undefined' ? globalThis : this);
