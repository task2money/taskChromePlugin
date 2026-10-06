'use strict';

async function handleGetOwnAgents(message) {
  await initApiFromMessage(message);
  let tenantId = String(message.companyId || message.tenantId || '').trim();
  let workspaceId = String(message.workspaceId || '').trim();
  let rows = [];
  try {
    const list = await API.getWorkspaces();
    rows = Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('[taskChromePlugin] own agents workspaces skipped', {
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
