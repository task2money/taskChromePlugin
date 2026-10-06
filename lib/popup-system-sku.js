/**
 * Popup「调用平台后端」后的智能体下拉（纯函数，无 HTTP）。
 * 仅 route=saas|system 时显示；未登录只提示先登录、不展示下拉；
 * 登录后列出自有智能体（供应商备注*模型）+ 系统智能体 SKU。
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

  function encodeOwnAgentValue(provider, model) {
    const p = String(provider || '').trim();
    const m = String(model || '').trim();
    if (!m) return OWN_VALUE;
    return `own:${encodeURIComponent(p)}|${encodeURIComponent(m)}`;
  }

  /**
   * @param {string|null|undefined} routeMode
   * @param {string|null|undefined} skuId
   * @param {string|null|undefined} ownProvider
   * @param {string|null|undefined} ownModel
   */
  function encodePlatformAgentValue(routeMode, skuId, ownProvider, ownModel) {
    const sku = String(skuId || '').trim();
    if (String(routeMode || '') === 'system' && sku) return `system:${sku}`;
    return encodeOwnAgentValue(ownProvider, ownModel);
  }

  function emptyParsed() {
    return { routeMode: 'saas', systemSkuId: '', ownProvider: '', ownModel: '' };
  }

  /**
   * @param {string|null|undefined} value
   * @returns {{ routeMode: 'saas'|'system', systemSkuId: string, ownProvider: string, ownModel: string }}
   */
  function parsePlatformAgentValue(value) {
    const raw = String(value || '').trim();
    if (raw.startsWith('system:')) {
      const sku = raw.slice('system:'.length).trim();
      if (sku) return { routeMode: 'system', systemSkuId: sku, ownProvider: '', ownModel: '' };
    }
    if (raw.startsWith('own:')) {
      const rest = raw.slice(4);
      const bar = rest.indexOf('|');
      if (bar >= 0) {
        try {
          return {
            routeMode: 'saas',
            systemSkuId: '',
            ownProvider: decodeURIComponent(rest.slice(0, bar)),
            ownModel: decodeURIComponent(rest.slice(bar + 1)),
          };
        } catch (_) { /* 非法编码则回退自有默认 */ }
      }
    }
    return emptyParsed();
  }

  /** `<供应商备注>*<模型>`；缺备注则用供应商名称。 */
  function formatOwnAgentOptionLabel(model, remark, provider) {
    const m = String(model || '').trim();
    if (!m) return '';
    const left = String(remark || '').trim() || String(provider || '').trim();
    return left ? `${left}*${m}` : m;
  }

  function splitSupportedModels(raw) {
    if (Array.isArray(raw)) {
      return raw.map((item) => String(item == null ? '' : item).trim()).filter(Boolean);
    }
    const text = String(raw || '').trim();
    if (!text) return [];
    return text
      .replace(/\r/g, '\n')
      .replace(/[，；;]/g, ',')
      .split(/[\n,\t ]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function providersFromPayload(data) {
    if (!data || typeof data !== 'object') return [];
    const ovOn = Boolean(data.page_advisor_override);
    const ovList = Array.isArray(data.page_advisor_providers) ? data.page_advisor_providers : [];
    if (ovOn && ovList.length) return ovList;
    if (data.use_company_default) {
      const co = data.company_config && Array.isArray(data.company_config.providers)
        ? data.company_config.providers : [];
      if (co.length) return co;
    }
    if (Array.isArray(data.providers) && data.providers.length) return data.providers;
    const co = data.company_config && Array.isArray(data.company_config.providers)
      ? data.company_config.providers : [];
    return co;
  }

  /**
   * @param {object|null|undefined} data feature-params GET 的 data
   * @returns {Array<{id:string,label:string,provider:string,model:string}>}
   */
  function collectOwnAgentOptions(data) {
    const out = [];
    const seen = new Set();
    for (const row of providersFromPayload(data)) {
      if (!row || typeof row !== 'object') continue;
      const provider = String(row.provider || '').trim();
      const remark = String(row.remark || '').trim();
      for (const model of splitSupportedModels(row.supported_models || row.supported_models_text)) {
        const id = encodeOwnAgentValue(provider, model);
        if (seen.has(id)) continue;
        seen.add(id);
        const label = formatOwnAgentOptionLabel(model, remark, provider);
        if (!label) continue;
        out.push({ id, label, provider, model });
      }
    }
    return out;
  }

  /**
   * @param {Array<{id?:string,name?:string}>} items
   * @param {string|null|undefined} lastSkuId
   */
  function buildSystemSkuMenu(items, lastSkuId) {
    return buildPlatformAgentMenu(items, lastSkuId ? 'system' : 'saas', lastSkuId, {});
  }

  /**
   * @param {Array<{id?:string,name?:string}>} items
   * @param {string|null|undefined} lastRoute
   * @param {string|null|undefined} lastSkuId
   * @param {{own?:string,ownGroup?:string,systemGroup?:string}} labels
   * @param {Array<{id:string,label:string}>|null|undefined} ownItems
   * @param {{ownProvider?:string,ownModel?:string}|null|undefined} lastOwn
   */
  function buildPlatformAgentMenu(items, lastRoute, lastSkuId, labels, ownItems, lastOwn) {
    const ownLabel = String((labels && labels.own) || '自有智能体').trim() || '自有智能体';
    const ownGroup = String((labels && labels.ownGroup) || '自有智能体').trim() || '自有智能体';
    const systemGroup = String((labels && labels.systemGroup) || '系统智能体').trim() || '系统智能体';
    const options = [];
    if (Array.isArray(ownItems) && ownItems.length) {
      for (let i = 0; i < ownItems.length; i += 1) {
        const item = ownItems[i];
        const id = String(item?.id || '').trim();
        const label = String(item?.label || '').trim();
        if (!id || !label) continue;
        options.push({ id, label, group: ownGroup });
      }
    }
    if (!options.length) {
      options.push({ id: OWN_VALUE, label: ownLabel, group: ownGroup });
    }
    const list = Array.isArray(items) ? items : [];
    for (let i = 0; i < list.length; i += 1) {
      const id = String(list[i]?.id || '').trim();
      if (!id) continue;
      const label = String(list[i]?.name || id).trim() || id;
      options.push({ id: `system:${id}`, label, group: systemGroup });
    }
    const wanted = encodePlatformAgentValue(
      lastRoute,
      lastSkuId,
      lastOwn && lastOwn.ownProvider,
      lastOwn && lastOwn.ownModel,
    );
    const known = options.some((item) => item.id === wanted);
    const firstOwn = options.find((item) => item.group === ownGroup);
    const selectedId = known ? wanted : (firstOwn ? firstOwn.id : OWN_VALUE);
    return { options, selectedId, persist: false };
  }

  function originFromApiBaseUrl(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    try {
      const u = new URL(text.includes('://') ? text : `https://${text}`);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.origin;
    } catch (_) {
      return '';
    }
  }

  function buildPageAdvisorSettingsHref(baseUrl, tenantId) {
    const origin = originFromApiBaseUrl(baseUrl) || 'https://www.aidevpush.com';
    const tid = String(tenantId || '').trim();
    if (!tid) return '';
    return `${origin}/tenant/${encodeURIComponent(tid)}/settings/page-advisor/`;
  }

  function saasSettingsLinkVisible(loggedIn) {
    return Boolean(loggedIn);
  }

  function applySaasSettingsLink(el, href, visible) {
    if (!el) return;
    const url = String(href || '').trim();
    const show = Boolean(visible) && Boolean(url);
    el.hidden = !show;
    if (url) el.href = url;
  }

  function isTenantAgentPrefPayload(data) {
    const mode = String(data && data.mode || '').trim();
    return mode === 'system' || mode === 'own';
  }

  function ownSelectionFromFeatureParams(data) {
    const d = data && typeof data === 'object' ? data : {};
    return {
      ownProvider: String(d.page_advisor_agent_model_provider || '').trim(),
      ownModel: String(d.page_advisor_agent_model || '').trim(),
    };
  }

  function llmFromTenantAgentPref(pref, ownFromFp) {
    const mode = String(pref && pref.mode || '').trim();
    if (mode === 'system') {
      const sku = String((pref && (pref.sku_id || pref.skuId)) || '').trim();
      return {
        routeMode: sku ? 'system' : 'saas',
        systemSkuId: sku,
        ownProvider: '',
        ownModel: '',
      };
    }
    const own = ownFromFp && typeof ownFromFp === 'object' ? ownFromFp : {};
    return {
      routeMode: 'saas',
      systemSkuId: '',
      ownProvider: String(own.ownProvider || '').trim(),
      ownModel: String(own.ownModel || '').trim(),
    };
  }

  function mergeLlmCfgWithTenantPref(llmCfg, data) {
    const cfg = llmCfg && typeof llmCfg === 'object' ? llmCfg : {};
    if (!isTenantAgentPrefPayload(data)) return cfg;
    const mapped = llmFromTenantAgentPref(data, ownSelectionFromFeatureParams(data));
    const out = Object.assign({}, cfg, mapped);
    if (mapped.routeMode !== 'system') {
      if (!mapped.ownModel) out.ownModel = String(cfg.ownModel || '');
      if (!mapped.ownProvider) out.ownProvider = String(cfg.ownProvider || '');
    }
    return out;
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
    encodeOwnAgentValue,
    formatOwnAgentOptionLabel,
    collectOwnAgentOptions,
    originFromApiBaseUrl,
    buildPageAdvisorSettingsHref,
    saasSettingsLinkVisible,
    applySaasSettingsLink,
    isTenantAgentPrefPayload,
    ownSelectionFromFeatureParams,
    llmFromTenantAgentPref,
    mergeLlmCfgWithTenantPref,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupSystemSkuMenu;
  }
  if (global) global.PopupSystemSkuMenu = PopupSystemSkuMenu;
})(typeof globalThis !== 'undefined' ? globalThis : this);
