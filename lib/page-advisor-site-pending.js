/**
 * Site-wide pending suggestions (ADR-0084) — pure helpers for SW + content.
 */

'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {
/**
 * @param {unknown} payload
 * @returns {object[]}
 */
function parseSitePendingItems(payload) {
  if (Array.isArray(payload?.items)) return payload.items.slice();
  if (Array.isArray(payload)) return payload.slice();
  return [];
}

/**
 * @param {object[]} items
 * @returns {object[]}
 */
function filterSitePendingOnly(items) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    const st = String(item?.confirm_status || item?.confirmStatus || 'pending').toLowerCase();
    return st === 'pending';
  });
}

/**
 * @param {{
 *   token?: string,
 *   tokenExpired?: boolean,
 *   pageUrl?: string,
 *   isAuthRoute?: boolean,
 * }} opts
 * @returns {boolean}
 */
/**
 * Company ids to query for the current page. Workspaces the user can open
 * come first; the resolved workspace company is the fallback.
 * @param {object[]} workspaces
 * @param {string} [fallbackId]
 * @returns {string[]}
 */
function tenantIdsForSitePending(workspaces, fallbackId) {
  const seen = new Set();
  const ids = [];
  for (const ws of Array.isArray(workspaces) ? workspaces : []) {
    const id = String(ws?.company_id || ws?.companyId || ws?.company || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const fallback = String(fallbackId || '').trim();
  if (!ids.length && fallback) ids.push(fallback);
  return ids;
}

function shouldFetchSitePending(opts) {
  if (!String(opts?.token || '').trim()) return false;
  if (opts?.tokenExpired) return false;
  if (opts?.isAuthRoute) return false;
  const url = String(opts?.pageUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (/^https?:\/\/(chrome|chrome-extension):/i.test(url)) return false;
  return true;
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isSkippableNavigationUrl(url) {
  const u = String(url || '').trim();
  if (!u) return true;
  if (/^(about:|chrome:|chrome-extension:|devtools:|edge:|moz-extension:)/i.test(u)) return true;
  return false;
}

/**
 * @param {object} item
 * @param {number} order
 * @param {(s: string) => string} esc
 * @returns {string}
 */
function buildSitePendingCardHtml(item, order, esc) {
  const e = typeof esc === 'function' ? esc : (s) => String(s ?? '');
  const id = e(String(item?.id != null ? item.id : ''));
  const tenant = e(String(item?.tenant_id || item?.tenantId || ''));
  const title = e(item?.title || tx('paPendingSuggestionTitle'));
  const summary = e(item?.summary || item?.detail || '');
  const idx = Number.isFinite(order) ? Math.floor(order) : 0;
  return `
    <div class="taskplugin-page-advisor-float-card taskplugin-page-advisor-site-pending-card"
      data-order="${idx}" data-sid="${id}" data-site-pending="1">
      <div class="taskplugin-page-advisor-card-chrome">
        <div class="taskplugin-page-advisor-drag-handle" role="button" tabindex="0"
          aria-label="${tx('paCardDragAria')}" title="${tx('paCardDragTitle')}">⋮⋮</div>
        <button type="button" class="taskplugin-page-advisor-dismiss taskplugin-page-advisor-site-dismiss-btn"
          data-sid="${id}" data-tenant="${tenant}" aria-label="${tx('paDismissAria')}" title="${tx('paDismissTitle')}">×</button>
      </div>
      <div class="taskplugin-page-advisor-site-pending-body">
        <strong class="taskplugin-page-advisor-site-title">${title}</strong>
        <span class="taskplugin-page-advisor-summary">${summary}</span>
        <div class="taskplugin-page-advisor-site-actions" role="group" aria-label="${tx('paActionsGroupAria')}">
          <button type="button" class="taskplugin-btn taskplugin-page-advisor-site-dismiss"
            data-sid="${id}" data-tenant="${tenant}">${tx('paDismiss')}</button>
          <button type="button" class="taskplugin-btn taskplugin-btn-primary taskplugin-page-advisor-site-confirm"
            data-sid="${id}" data-tenant="${tenant}">${tx('paConfirmRun')}</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Adopt / discard bar for a saved suggestion row shown with live anchors.
 * @param {string} suggestionId
 * @param {string} tenantId
 * @param {(s: string) => string} esc
 * @returns {string}
 */
/**
 * Label for one saved suggestion post. Falls back to a numbered title.
 * @param {object} post
 * @param {number} index zero-based
 * @returns {string}
 */
function sitePendingPostLabel(post, index) {
  const title = String(post?.title || '').trim();
  if (title) return title;
  const n = (Number.isFinite(index) ? Math.floor(index) : 0) + 1;
  return tx('paSitePostFallback', { n });
}

/**
 * Which post stays selected. Keeps the current id when it is still pending.
 * @param {{ id?: string }[]} posts
 * @param {string} [preferredId]
 * @returns {string}
 */
function pickSitePendingPostId(posts, preferredId) {
  const list = Array.isArray(posts) ? posts : [];
  const preferred = String(preferredId || '');
  if (preferred && list.some((post) => String(post?.id || '') === preferred)) return preferred;
  if (!list.length) return '';
  return String(list[list.length - 1]?.id || '');
}

/**
 * Drop the post the user just adopted or discarded.
 * @param {{ id?: string }[]} posts
 * @param {string} markedId
 * @returns {object[]}
 */
function sitePendingPostsAfterMark(posts, markedId) {
  const id = String(markedId || '');
  return (Array.isArray(posts) ? posts : []).filter((post) => String(post?.id || '') !== id);
}

/**
 * Tab buttons for switching posts. One pending post has no tab strip.
 * @param {object[]} posts
 * @param {string} activeId
 * @param {(s: string) => string} esc
 * @returns {string}
 */
function buildSitePendingTabsHtml(posts, activeId, esc) {
  const list = Array.isArray(posts) ? posts : [];
  if (list.length < 2) return '';
  const e = typeof esc === 'function' ? esc : (s) => String(s ?? '');
  const current = String(activeId || '');
  return list.map((post, index) => {
    const id = String(post?.id || '');
    const n = index + 1;
    const title = sitePendingPostLabel(post, index);
    const selected = id === current ? 'true' : 'false';
    return `<button type="button" class="taskplugin-page-advisor-post-tab" role="tab" id="taskplugin-page-advisor-post-tab-${e(id)}" data-post-id="${e(id)}" aria-selected="${selected}" aria-label="${e(tx('paSitePostTabAria', { n, title }))}">${e(title)}</button>`;
  }).join('');
}

function buildSitePendingDecisionHtml(suggestionId, tenantId, esc) {
  const e = typeof esc === 'function' ? esc : (s) => String(s ?? '');
  const id = e(String(suggestionId || ''));
  const tenant = e(String(tenantId || ''));
  if (!id) return '';
  return `
    <div class="taskplugin-page-advisor-site-actions" role="group" aria-label="${tx('paActionsGroupAria')}">
      <button type="button" class="taskplugin-btn taskplugin-page-advisor-site-dismiss"
        data-sid="${id}" data-tenant="${tenant}">${tx('paDismiss')}</button>
      <button type="button" class="taskplugin-btn taskplugin-btn-primary taskplugin-page-advisor-site-confirm"
        data-sid="${id}" data-tenant="${tenant}">${tx('paConfirmRun')}</button>
    </div>`;
}

const PageAdvisorSitePending = {
  parseSitePendingItems,
  filterSitePendingOnly,
  tenantIdsForSitePending,
  shouldFetchSitePending,
  isSkippableNavigationUrl,
  buildSitePendingCardHtml,
  buildSitePendingDecisionHtml,
  sitePendingPostLabel,
  pickSitePendingPostId,
  sitePendingPostsAfterMark,
  buildSitePendingTabsHtml,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorSitePending;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorSitePending = PageAdvisorSitePending;
}
}
