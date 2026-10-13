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
  if (!tenantId && !(Array.isArray(workspaces) && workspaces.length)) {
    return { ok: false, reason: 'no_tenant' };
  }
  return { ok: true, tenantId, workspaces };
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
function publishAgentSuggestionsListed(tabId, collected) {
  const raw = Array.isArray(collected?.items) ? collected.items : [];
  const Pending = typeof PageAdvisorSitePending !== 'undefined' ? PageAdvisorSitePending : null;
  const items = Pending?.filterSitePendingOnly ? Pending.filterSitePendingOnly(raw) : raw;
  const payload = {
    action: 'agentSuggestionsListed',
    tabId,
    count: items.length,
    items,
    reason: collected?.reason || '',
    ok: collected?.ok !== false,
    pageUrl: collected?.pageUrl || '',
  };
  console.info('[taskChromePlugin] agent_suggestions_listed', {
    tabId,
    count: items.length,
    reason: payload.reason,
  });
  try {
    const send = chrome?.runtime?.sendMessage;
    if (typeof send !== 'function') return;
    const pending = send(payload);
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch (_err) {
    /* side panel may be closed */
  }
}

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

  const collected = await collectSitePendingForUrl(url);
  publishAgentSuggestionsListed(tabId, collected);
  if (!collected.ok || collected.skipped) return collected;
  const items = collected.items || [];
  await notifyContentSitePending(tabId, {
    ok: true,
    tenantId: String(collected.tenantId || ''),
    pageUrl: url,
    items,
  });
  return { ok: true, count: items.length, items };
}

/**
 * Pending posts for one page URL, without notifying the content script.
 * 网址固定去掉查询串：生成与查询共用同一口径，否则带参数的网页永远对不上。
 * @param {string} pageUrl
 */
async function collectSitePendingForUrl(pageUrl) {
  const rawUrl = String(pageUrl || '').trim();
  const Pending = typeof PageAdvisorSitePending !== 'undefined' ? PageAdvisorSitePending : null;
  const url = Pending?.pageUrlForAgentSuggestions
    ? Pending.pageUrlForAgentSuggestions(rawUrl)
    : rawUrl;
  if (!url || Pending?.isSkippableNavigationUrl?.(url)) {
    return { ok: true, skipped: true, items: [] };
  }
  const tenant = await resolveTenantIdForSitePending();
  if (!tenant.ok) {
    return { ok: true, skipped: true, reason: tenant.reason, items: [] };
  }
  const tenantIds = Pending?.tenantIdsForSitePending
    ? Pending.tenantIdsForSitePending(tenant.workspaces, tenant.tenantId)
    : [tenant.tenantId].filter(Boolean);
  const items = [];
  let anyOk = false;
  let lastErr = null;
  for (const tid of tenantIds) {
    let listPayload;
    try {
      listPayload = await PageAdvisorAPI.listPendingSuggestions(tid, url);
      anyOk = true;
    } catch (e) {
      lastErr = e;
      console.warn('[taskChromePlugin] listPendingSuggestions failed:', e?.message || e);
      continue;
    }
    const raw = Pending?.parseSitePendingItems
      ? Pending.parseSitePendingItems(listPayload)
      : (Array.isArray(listPayload?.items) ? listPayload.items : []);
    const pending = Pending?.filterSitePendingOnly
      ? Pending.filterSitePendingOnly(raw)
      : raw;
    for (const item of pending) {
      items.push(Object.assign({}, item, {
        tenant_id: String(item?.tenant_id || item?.tenantId || tid),
      }));
    }
  }
  if (!anyOk && lastErr) {
    return {
      ok: false,
      items: [],
      error: lastErr?.message || tx('swPendingFetchFailed'),
      traceId: lastErr?.traceId || '',
    };
  }
  return {
    ok: true,
    items,
    tenantId: String(items[0]?.tenant_id || tenant.tenantId || ''),
    pageUrl: url,
  };
}

async function refreshSitePendingForActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab?.id || !tab.url) return { ok: true, skipped: true };
  return refreshSitePendingForTab(tab.id, tab.url, { force: true });
}

/** 列表固定看当前标签页；消息里带的网址一律忽略（ADR-0167 去掉了网址框）。 */
async function handleListSitePendingForActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  const pageUrl = String(tab?.url || '').trim();
  if (!pageUrl) return { success: true, items: [], skipped: true };
  const collected = await collectSitePendingForUrl(pageUrl);
  publishAgentSuggestionsListed(tab?.id, collected);
  if (!collected.ok) {
    return {
      success: false,
      error: collected.error || tx('agentSuggestionsLoadFail'),
      traceId: collected.traceId || '',
      items: [],
    };
  }
  return {
    success: true,
    items: collected.items || [],
    pageUrl: collected.pageUrl || pageUrl,
    reason: collected.reason || '',
  };
}

async function handleRefreshSitePendingForActiveTab() {
  const result = await refreshSitePendingForActiveTab();
  return { success: true, ...result };
}

async function handleSelectAgentSuggestionPost(message) {
  if (message?.applyToPage === false) return { success: true, skipped: true };
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab?.id) return { success: false, error: tx('swNoActiveTab') };
  const msg = {
    action: 'selectAgentSuggestionPost',
    postId: String(message?.postId || ''),
    item: message?.item || null,
  };
  console.info('[taskChromePlugin] agent_suggestion_selected', {
    tabId: tab.id,
    postId: msg.postId,
  });
  try {
    await chrome.tabs.sendMessage(tab.id, msg, { frameId: 0 });
  } catch (_frame0Err) {
    try {
      await chrome.tabs.sendMessage(tab.id, msg);
    } catch (e) {
      console.warn('[taskChromePlugin] selectAgentSuggestionPost 投递失败:', e?.message || e);
      return { success: false, error: e?.message || tx('contentShowSitePendingFailed') };
    }
  }
  return { success: true };
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
    const force = details.transitionType === 'reload';
    return refreshSitePendingForTab(details.tabId, url, { force }).catch((e) => {
      console.warn('[taskChromePlugin] refreshSitePendingForTab:', e?.message || e);
    });
  });
}
