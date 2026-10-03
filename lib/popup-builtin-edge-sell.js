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

  const PopupBuiltinEdgeSellMenu = {
    applyEdgeSellSectionVisibility,
    buildEdgeOfferSelectMenu,
    applyEdgeOfferSelect,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupBuiltinEdgeSellMenu;
  }
  if (global) global.PopupBuiltinEdgeSellMenu = PopupBuiltinEdgeSellMenu;
})(typeof globalThis !== 'undefined' ? globalThis : this);
