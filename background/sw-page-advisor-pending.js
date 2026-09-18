/** Fetch site pending suggestions on navigation; confirm/dismiss via PageAdvisorAPI. */

'use strict';

const SITE_PENDING_FETCH_DEBOUNCE_MS = 2000;
const sitePendingFetchLastAt = new Map();

/**
 * @returns {Promise<{ ok: boolean, tenantId?: string, reason?: string }>}
 */
async function resolveTenantIdForSitePending() {
  await Storage.migrateStaleTokenExpiryOnce();
  const cfg = await Storage.getApiConfig();
  const mapping = await Storage.getEndpointMapping();
  const cred = await Storage.getCredentials();
  const expired = cfg.token ? await Storage.isTokenExpired() : false;

  if (!cfg.token || expired) {
    return { ok: false, reason: 'not_logged_in' };
  }

  API.init(cfg.baseUrl, cfg.token, mapping, cred.userId || '');
  if (mapping.owner) API.setOwner(mapping.owner);

  const lastWorkspaceId = await Storage.getLastWorkspace();
  let workspaces = [];
  try {
    const list = await API.getWorkspaces();
    workspaces = Array.isArray(list) ? list : (list?.results || list?.items || list?.data || []);
  } catch (e) {
    console.warn('[taskChromePlugin] site pending getWorkspaces:', e?.message || e);
  }

  const resolved = (typeof PageAdvisorDefaults !== 'undefined'
    && PageAdvisorDefaults.resolvePageAdvisorWorkspace)
    ? PageAdvisorDefaults.resolvePageAdvisorWorkspace({
      floatWorkspaceId: '',
      floatCompanyId: '',
      lastWorkspaceId,
      workspaces,
    })
    : { workspaceId: '', companyId: '', source: '' };

  const tenantId = String(resolved.companyId || '').trim();
  if (!tenantId) {
    return { ok: false, reason: 'no_tenant' };
  }
  return { ok: true, tenantId };
}

async function notifyContentSitePending(tabId, payload) {
  const msg = { action: 'pageAdvisorSitePending', ...payload };
  try {
    await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch (frame0Err) {
    try {
      await chrome.tabs.sendMessage(tabId, msg);
    } catch (e) {
      console.warn('[taskChromePlugin] pageAdvisorSitePending 投递失败:', e?.message || e);
    }
  }
}

/**
 * @param {number} tabId
 * @param {string} pageUrl
 * @param {{ force?: boolean }} [opts]
 */
async function refreshSitePendingForTab(tabId, pageUrl, opts = {}) {
  const url = String(pageUrl || '').trim();
  const Pending = typeof PageAdvisorSitePending !== 'undefined' ? PageAdvisorSitePending : null;
  if (Pending?.isSkippableNavigationUrl?.(url)) return { ok: true, skipped: true };

  const debKey = `${tabId}:${url}`;
  const now = Date.now();
  if (!opts.force) {
    const last = sitePendingFetchLastAt.get(debKey) || 0;
    if (now - last < SITE_PENDING_FETCH_DEBOUNCE_MS) {
      return { ok: true, skipped: true, reason: 'debounce' };
    }
  }
  sitePendingFetchLastAt.set(debKey, now);

  const tenant = await resolveTenantIdForSitePending();
  if (!tenant.ok) {
    return { ok: true, skipped: true, reason: tenant.reason };
  }

  let listPayload;
  try {
    listPayload = await PageAdvisorAPI.listPendingSuggestions(tenant.tenantId, url);
  } catch (e) {
    console.warn('[taskChromePlugin] listPendingSuggestions failed:', e?.message || e);
    return { ok: false, error: e?.message || tx('swPendingFetchFailed'), traceId: e?.traceId || '' };
  }

  const raw = Pending?.parseSitePendingItems
    ? Pending.parseSitePendingItems(listPayload)
    : (Array.isArray(listPayload?.items) ? listPayload.items : []);
  const items = Pending?.filterSitePendingOnly
    ? Pending.filterSitePendingOnly(raw)
    : raw;

  await notifyContentSitePending(tabId, {
    ok: true,
    tenantId: tenant.tenantId,
    pageUrl: url,
    items,
  });
  return { ok: true, count: items.length };
}

async function handleFetchSitePendingForPage(message, sender) {
  const tabId = sender?.tab?.id;
  if (!tabId) return { success: false, error: tx('swMissingTabId') };
  const pageUrl = String(message.pageUrl || '').trim();
  if (!pageUrl) return { success: false, error: tx('swMissingPageUrl') };
  const result = await refreshSitePendingForTab(tabId, pageUrl, { force: !!message.force });
  return { success: true, ...result };
}

async function handleConfirmSitePendingSuggestion(message) {
  const tenantId = String(message.tenantId || '').trim();
  const suggestionId = String(message.suggestionId || '').trim();
  const idempotencyKey = String(message.idempotencyKey || '').trim();
  if (!tenantId || !suggestionId) {
    return { success: false, error: tx('swMissingTenantOrSuggestionId') };
  }
  if (!idempotencyKey) {
    return { success: false, error: tx('swMissingIdempotencyKey') };
  }
  const tenant = await resolveTenantIdForSitePending();
  if (!tenant.ok) {
    return { success: false, error: tx('swLoginBeforeConfirm') };
  }
  try {
    const data = await PageAdvisorAPI.confirmSuggestion(
      tenantId,
      suggestionId,
      idempotencyKey,
    );
    return { success: true, data, traceId: data?.trace_id || data?._resolvedTraceId || '' };
  } catch (e) {
    return {
      success: false,
      error: e?.message || tx('swConfirmSuggestionFailed'),
      traceId: e?.traceId || '',
      errorCode: e?.errorCode || '',
    };
  }
}

async function handleDismissSitePendingSuggestion(message) {
  const tenantId = String(message.tenantId || '').trim();
  const suggestionId = String(message.suggestionId || '').trim();
  const idempotencyKey = String(message.idempotencyKey || '').trim();
  if (!tenantId || !suggestionId) {
    return { success: false, error: tx('swMissingTenantOrSuggestionId') };
  }
  if (!idempotencyKey) {
    return { success: false, error: tx('swMissingIdempotencyKey') };
  }
  const tenant = await resolveTenantIdForSitePending();
  if (!tenant.ok) {
    return { success: false, error: tx('swLoginBeforeDismiss') };
  }
  try {
    const data = await PageAdvisorAPI.dismissSuggestion(
      tenantId,
      suggestionId,
      idempotencyKey,
    );
    return { success: true, data, traceId: data?.trace_id || data?._resolvedTraceId || '' };
  } catch (e) {
    return {
      success: false,
      error: e?.message || tx('swDismissSuggestionFailed'),
      traceId: e?.traceId || '',
      errorCode: e?.errorCode || '',
    };
  }
}

function registerPageAdvisorSitePendingHooks() {
  if (!chrome.webNavigation?.onCompleted) return;

  chrome.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return;
    const url = String(details.url || '');
    const Pending = typeof PageAdvisorSitePending !== 'undefined' ? PageAdvisorSitePending : null;
    if (Pending?.isSkippableNavigationUrl?.(url)) return;
    void refreshSitePendingForTab(details.tabId, url).catch((e) => {
      console.warn('[taskChromePlugin] refreshSitePendingForTab:', e?.message || e);
    });
  });
}
