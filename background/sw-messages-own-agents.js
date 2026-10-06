'use strict';

async function resolveTenantWorkspaceFromMessage(message) {
  let tenantId = String(message?.companyId || message?.tenantId || '').trim();
  let workspaceId = String(message?.workspaceId || '').trim();
  let rows = [];
  try {
    const list = await API.getWorkspaces();
    rows = Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('[taskChromePlugin] resolve tenant workspaces skipped', {
      message: e?.message || '', traceId: e?.traceId || '',
    });
  }
  let lastId = '';
  try {
    lastId = String((await Storage.getLastWorkspace()) || '');
  } catch (_) { /* 无上次工作空间 */ }
  const hit = rows.find((ws) => String(ws?.id || ws?._id || '') === lastId) || rows[0];
  if (!tenantId) tenantId = String(hit?.company_id || hit?.companyId || '').trim();
  if (!workspaceId) workspaceId = String(hit?.id || hit?._id || lastId || '').trim();
  return { tenantId, workspaceId };
}

async function handleGetOwnAgents(message) {
  await initApiFromMessage(message);
  const resolved = await resolveTenantWorkspaceFromMessage(message);
  const tenantId = resolved.tenantId;
  const workspaceId = resolved.workspaceId;
  const Menu = (typeof PopupSystemSkuMenu !== 'undefined') ? PopupSystemSkuMenu : null;
  const collect = Menu && typeof Menu.collectOwnAgentOptions === 'function'
    ? (payload) => Menu.collectOwnAgentOptions(payload)
    : () => [];
  const pickData = (resp) => (resp && typeof resp === 'object' && resp.data) ? resp.data : resp;
  if (tenantId && workspaceId && typeof API.getWorkspaceFeatureParamsSummary === 'function') {
    try {
      const ws = await API.getWorkspaceFeatureParamsSummary(tenantId, workspaceId);
      const own = collect(pickData(ws));
      if (own.length) {
        console.info('[taskChromePlugin] own agents from workspace', {
          tenantId, workspaceId, count: own.length,
        });
        return { success: true, data: pickData(ws) };
      }
    } catch (e) {
      console.warn('[taskChromePlugin] workspace own agents skipped', {
        message: e?.message || '', traceId: e?.traceId || '',
      });
    }
  }
  if (tenantId && typeof API.getCompanyFeatureParamsSummary === 'function') {
    try {
      const co = await API.getCompanyFeatureParamsSummary(tenantId);
      const own = collect(pickData(co));
      if (own.length) {
        console.info('[taskChromePlugin] own agents from company', { tenantId, count: own.length });
        return { success: true, data: pickData(co) };
      }
    } catch (e) {
      console.warn('[taskChromePlugin] company own agents skipped', {
        message: e?.message || '', traceId: e?.traceId || '',
      });
    }
  }
  if (typeof API.getPersonalFeatureParamsConfigs === 'function') {
    const personal = await API.getPersonalFeatureParamsConfigs();
    const items = Array.isArray(personal) ? personal : (personal?.results || personal?.data || personal?.items || []);
    for (const item of items) {
      const own = collect(item);
      if (own.length) {
        console.info('[taskChromePlugin] own agents from personal', { count: own.length });
        return { success: true, data: item };
      }
    }
  }
  return { success: true, data: { providers: [] } };
}

async function handleGetTenantAgentPref(message) {
  await initApiFromMessage(message);
  const { tenantId } = await resolveTenantWorkspaceFromMessage(message);
  let baseUrl = '';
  try {
    const cfg = (typeof Storage !== 'undefined' && typeof Storage.getApiConfig === 'function')
      ? await Storage.getApiConfig()
      : {};
    baseUrl = String(cfg?.baseUrl || '').trim();
  } catch (_) { /* 无会话 */ }
  const data = { mode: 'own', sku_id: '', tenantId, baseUrl };
  if (!tenantId || typeof PageAdvisorAPI === 'undefined'
    || typeof PageAdvisorAPI.getTenantAgentPref !== 'function') {
    return { success: true, data };
  }
  try {
    const pref = await PageAdvisorAPI.getTenantAgentPref(tenantId);
    if (pref && typeof pref === 'object') {
      if (pref.mode) data.mode = String(pref.mode);
      if (pref.sku_id || pref.skuId) data.sku_id = String(pref.sku_id || pref.skuId || '');
    }
  } catch (e) {
    console.warn('[taskChromePlugin] tenant agent pref skipped', {
      message: e?.message || '', traceId: e?.traceId || '',
    });
  }
  if (tenantId && typeof API.getCompanyFeatureParamsSummary === 'function') {
    try {
      const co = await API.getCompanyFeatureParamsSummary(tenantId);
      const payload = (co && typeof co === 'object' && co.data) ? co.data : co;
      if (payload && typeof payload === 'object') {
        data.page_advisor_agent_model = payload.page_advisor_agent_model;
        data.page_advisor_agent_model_provider = payload.page_advisor_agent_model_provider;
      }
    } catch (e) {
      console.warn('[taskChromePlugin] tenant own model skipped', {
        message: e?.message || '', traceId: e?.traceId || '',
      });
    }
  }
  return { success: true, data };
}

async function overlayPageAdvisorTenantPref(llmCfg, tenantId) {
  const cfg = llmCfg && typeof llmCfg === 'object' ? llmCfg : {};
  const tid = String(tenantId || '').trim();
  if (!tid) return cfg;
  try {
    const res = await handleGetTenantAgentPref({ tenantId: tid });
    if (!res || res.success === false || !res.data) return cfg;
    const Menu = (typeof PopupSystemSkuMenu !== 'undefined') ? PopupSystemSkuMenu : null;
    if (!Menu || typeof Menu.mergeLlmCfgWithTenantPref !== 'function') return cfg;
    const merged = Menu.mergeLlmCfgWithTenantPref(cfg, res.data);
    if (typeof PageAdvisorLlmConfig !== 'undefined'
      && typeof PageAdvisorLlmConfig.saveToStorage === 'function') {
      await PageAdvisorLlmConfig.saveToStorage({
        routeMode: merged.routeMode,
        systemSkuId: merged.systemSkuId,
        ownProvider: merged.ownProvider,
        ownModel: merged.ownModel,
        profileAction: 'route-only',
      }).catch(() => {});
    }
    console.info('[taskChromePlugin] overlay tenant agent pref', {
      tenantId: tid,
      mode: res.data.mode || '',
    });
    return merged;
  } catch (e) {
    console.warn('[taskChromePlugin] tenant agent pref overlay skipped', {
      message: e?.message || '', traceId: e?.traceId || '',
    });
    return cfg;
  }
}
