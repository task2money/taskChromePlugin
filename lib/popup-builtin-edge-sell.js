/**
 * Popup「本机模型出售」：登录可见性与出售项目下拉（纯函数，无 HTTP）。
 */
(function (global) {
  'use strict';

  /**
   * @param {{hidden?:boolean,style?:{display?:string}}|null|undefined} section
   * @param {boolean} loggedIn
   */
  function applyEdgeSellSectionVisibility(section, loggedIn) {
    if (!section) return;
    const visible = Boolean(loggedIn);
    section.hidden = !visible;
    if (section.style) section.style.display = visible ? '' : 'none';
  }

  /**
   * @param {Array<{id?:string,title?:string,status?:string}>|null|undefined} offers
   * @param {string|null|undefined} selectedId
   * @param {{placeholder?:string,pausedSuffix?:string}|null|undefined} labels
   * @returns {{ options: Array<{id:string,label:string}>, selectedId: string }}
   */
  function buildEdgeOfferSelectMenu(offers, selectedId, labels) {
    const list = Array.isArray(offers) ? offers : [];
    const placeholder = String(labels?.placeholder || '').trim();
    const pausedSuffix = String(labels?.pausedSuffix || '').trim();
    const options = [];
    if (placeholder) {
      options.push({ id: '', label: placeholder });
    }
    for (let i = 0; i < list.length; i += 1) {
      const id = String(list[i]?.id || '').trim();
      if (!id) continue;
      const title = String(list[i]?.title || id).trim() || id;
      const status = String(list[i]?.status || '').trim().toLowerCase();
      let label = title;
      if (status === 'paused' && pausedSuffix) {
        label = `${title} ${pausedSuffix}`;
      }
      options.push({ id, label });
    }
    const last = String(selectedId || '').trim();
    const known = options.some((item) => item.id && item.id === last);
    let nextSelected = known ? last : '';
    if (!nextSelected) {
      const real = options.filter((item) => item.id);
      if (real.length === 1) nextSelected = real[0].id;
    }
    return { options, selectedId: nextSelected };
  }

  /**
   * @param {{options?:Array<{id:string,label:string}>,selectedId?:string}|null|undefined} menu
   * @param {{innerHTML?:string,value?:string}|null|undefined} selectEl
   */
  function applyEdgeOfferSelect(selectEl, menu) {
    if (!selectEl) return;
    const options = Array.isArray(menu?.options) ? menu.options : [];
    selectEl.innerHTML = options
      .map((opt) => {
        const id = String(opt?.id ?? '');
        const label = String(opt?.label ?? id);
        const esc = (s) => String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
        return `<option value="${esc(id)}">${esc(label)}</option>`;
      })
      .join('');
    selectEl.value = String(menu?.selectedId || '');
  }

  /**
   * @param {{projectId?:string,nodeId?:string}|null|undefined} active
   * @returns {boolean}
   */
  function isEdgeSellRegistered(active) {
    return Boolean(String(active?.projectId || '').trim() && String(active?.nodeId || '').trim());
  }

  /**
   * Toggle register form vs registered status panel.
   * @param {{hidden?:boolean,style?:{display?:string}}|null|undefined} registerPanel
   * @param {{hidden?:boolean,style?:{display?:string}}|null|undefined} registeredPanel
   * @param {boolean} registered
   */
  function applyEdgeSellRegisteredMode(registerPanel, registeredPanel, registered) {
    const showReg = Boolean(registered);
    if (registerPanel) {
      registerPanel.hidden = showReg;
      if (registerPanel.style) registerPanel.style.display = showReg ? 'none' : '';
    }
    if (registeredPanel) {
      registeredPanel.hidden = !showReg;
      if (registeredPanel.style) registeredPanel.style.display = showReg ? '' : 'none';
    }
  }

  /**
   * @param {{status?:string,inflight?:number,max_concurrency?:number,dispatch_count?:number,success_count?:number,error_count?:number,last_seen_at?:string,last_dispatch_at?:string,device_label?:string}|null|undefined} node
   * @param {{projectTitle?:string,projectId?:string,nodeId?:string}|null|undefined} meta
   * @param {{labels?:Record<string,string>}|null|undefined} opts
   * @returns {{ registrationLines: string[], callLines: string[] }}
   */
  function formatEdgeSellRegisteredView(node, meta, opts) {
    const L = opts?.labels || {};
    const projectTitle = String(meta?.projectTitle || '').trim();
    const projectId = String(meta?.projectId || node?.offer_id || '').trim();
    const nodeId = String(meta?.nodeId || node?.id || '').trim();
    const status = String(node?.status || '').trim() || '—';
    const label = String(node?.device_label || meta?.deviceLabel || '').trim();
    const registrationLines = [
      `${L.project || '项目'}: ${projectTitle || projectId || '—'}`,
      `${L.node || '节点'}: ${nodeId || '—'}`,
      `${L.status || '状态'}: ${status}`,
    ];
    if (label) registrationLines.push(`${L.device || '设备'}: ${label}`);
    if (node?.last_seen_at) {
      registrationLines.push(`${L.lastSeen || '最近保活'}: ${node.last_seen_at}`);
    }
    const inflight = Number(node?.inflight || 0);
    const maxC = Number(node?.max_concurrency || 0);
    const callLines = [
      `${L.inflight || '进行中'}: ${inflight}/${maxC || '—'}`,
      `${L.dispatch || '已分派'}: ${Number(node?.dispatch_count || 0)}`,
      `${L.success || '成功'}: ${Number(node?.success_count || 0)}`,
      `${L.error || '失败'}: ${Number(node?.error_count || 0)}`,
    ];
    if (node?.last_dispatch_at) {
      callLines.push(`${L.lastDispatch || '最近分派'}: ${node.last_dispatch_at}`);
    }
    return { registrationLines, callLines };
  }

  const PopupBuiltinEdgeSellMenu = {
    applyEdgeSellSectionVisibility,
    buildEdgeOfferSelectMenu,
    applyEdgeOfferSelect,
    isEdgeSellRegistered,
    applyEdgeSellRegisteredMode,
    formatEdgeSellRegisteredView,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupBuiltinEdgeSellMenu;
  }
  if (global) global.PopupBuiltinEdgeSellMenu = PopupBuiltinEdgeSellMenu;
})(typeof globalThis !== 'undefined' ? globalThis : this);
