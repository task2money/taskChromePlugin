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
  const title = e(item?.title || '待确认建议');
  const summary = e(item?.summary || item?.detail || '');
  const idx = Number.isFinite(order) ? Math.floor(order) : 0;
  return `
    <div class="taskplugin-page-advisor-float-card taskplugin-page-advisor-site-pending-card"
      data-order="${idx}" data-sid="${id}" data-site-pending="1">
      <div class="taskplugin-page-advisor-card-chrome">
        <div class="taskplugin-page-advisor-drag-handle" role="button" tabindex="0"
          aria-label="拖动建议卡，双击复位" title="拖动移动；双击把手复位">⋮⋮</div>
        <button type="button" class="taskplugin-page-advisor-dismiss taskplugin-page-advisor-site-dismiss-btn"
          data-sid="${id}" aria-label="拒绝此建议" title="拒绝并关闭">×</button>
      </div>
      <div class="taskplugin-page-advisor-site-pending-body">
        <strong class="taskplugin-page-advisor-site-title">${title}</strong>
        <span class="taskplugin-page-advisor-summary">${summary}</span>
        <div class="taskplugin-page-advisor-site-actions" role="group" aria-label="待确认建议操作">
          <button type="button" class="taskplugin-btn taskplugin-page-advisor-site-dismiss"
            data-sid="${id}">拒绝</button>
          <button type="button" class="taskplugin-btn taskplugin-btn-primary taskplugin-page-advisor-site-confirm"
            data-sid="${id}">确认开跑</button>
        </div>
      </div>
    </div>
  `;
}

const PageAdvisorSitePending = {
  parseSitePendingItems,
  filterSitePendingOnly,
  shouldFetchSitePending,
  isSkippableNavigationUrl,
  buildSitePendingCardHtml,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorSitePending;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorSitePending = PageAdvisorSitePending;
}
}
