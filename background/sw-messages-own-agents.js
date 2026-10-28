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

// 自有智能体下拉随本地提示词 / 直连链一并下线；保留消息契约，旧页面不会等超时。
async function handleGetOwnAgents(message) {
  await initApiFromMessage(message);
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
