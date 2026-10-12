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
 * Calendar date of the saved post. Uses the UTC date prefix so the label
 * does not shift with the machine timezone.
 * @param {object} post
 * @returns {string}
 */
function sitePendingGeneratedDate(post) {
  const raw = String(post?.created_at || post?.createdAt || '').trim();
  const matched = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return matched ? matched[1] : '';
}

/**
 * How many suggestion cards sit inside one post.
 * A post with no anchored cards is still one suggestion.
 * @param {object} post
 * @returns {number}
 */
function sitePendingSuggestionCount(post) {
  const list = Array.isArray(post?.suggestions) ? post.suggestions : [];
  if (list.length > 0) return list.length;
  return 1;
}

/**
 * Prompt type that produced the post. A stored tendency wins.
 * Older rows fall back to the prompt name in front of the page URL.
 * @param {object} post
 * @returns {string}
 */
function sitePendingPromptTypeLabel(post) {
  const raw = String(post?.prompt_tendency || post?.promptTendency || '').trim();
  const known = {
    a11y: 'paSkillTendencyA11y',
    conversion: 'paSkillTendencyConversion',
    perf: 'paSkillTendencyPerf',
    seo: 'paSkillTendencySeo',
    custom: 'paSkillTendencyCustom',
  };
  const key = known[raw.toLowerCase()];
  if (key) return tx(key);
  if (raw) return raw;
  const title = String(post?.title || '').trim();
  const cut = title.split(' · ')[0].trim();
  return cut;
}

/**
 * One line under the post title: date, card count, prompt type.
 * @param {object} post
 * @returns {string}
 */
function sitePendingPostMeta(post) {
  const date = sitePendingGeneratedDate(post);
  const count = sitePendingSuggestionCount(post);
  const typeLabel = sitePendingPromptTypeLabel(post);
  const parts = [];
  if (date) parts.push(date);
  parts.push(tx('agentSuggestionsPostCount', { n: count }));
  if (typeLabel) parts.push(typeLabel);
  return parts.join(' · ');
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
 * Page surface for saved suggestion posts.
 * The list never mounts the suggestion overlay or the sticker strip.
 * A sidebar sticker selection shows that post's suggestions, still without stickers on the page.
 * A post with no rebound suggestions does not open the overlay.
 * @param {'list'|'sidebar-select'} trigger
 * @param {object[]} posts
 * @param {string} postId
 * @param {{ selectedBySidebar?: boolean }} [opts]
 * @returns {{ kind: 'hide-overlay'|'show-suggestion', showPostTabs: false, postId: string }}
 */
function nextSitePendingPageAction(trigger, posts, postId, opts) {
  const selected = trigger === 'sidebar-select' || !!(opts && opts.selectedBySidebar);
  if (!selected) {
    return { kind: 'hide-overlay', showPostTabs: false, postId: '' };
  }
  const id = pickSitePendingPostId(posts, postId);
  const post = (Array.isArray(posts) ? posts : []).find((item) => String(item?.id || '') === id);
  const suggestions = post && Array.isArray(post.suggestions) ? post.suggestions : [];
  if (!post || !suggestions.length) {
    return { kind: 'hide-overlay', showPostTabs: false, postId: id || '' };
  }
  return { kind: 'show-suggestion', showPostTabs: false, postId: id };
}

/**
 * One tab entry per pending post. The title switches the visible suggestions.
 * Adopt and discard sit on the same entry and mark that post.
 * @param {object[]} posts
 * @param {string} activeId
 * @param {(s: string) => string} esc
 * @returns {string}
 */
function buildSitePendingTabsHtml(posts, activeId, esc) {
  const list = Array.isArray(posts) ? posts : [];
  if (!list.length) return '';
  const e = typeof esc === 'function' ? esc : (s) => String(s ?? '');
  const current = String(activeId || '');
  return list.map((post, index) => {
    const id = String(post?.id || '');
    const tenant = e(String(post?.tenantId || post?.tenant_id || ''));
    const n = index + 1;
    const title = sitePendingPostLabel(post, index);
    const meta = sitePendingPostMeta(post);
    const selected = id === current ? 'true' : 'false';
    return `<div class="taskplugin-page-advisor-post-tab" role="tab" id="taskplugin-page-advisor-post-tab-${e(id)}" aria-selected="${selected}">
      <button type="button" class="taskplugin-page-advisor-post-tab-select" data-post-id="${e(id)}" aria-selected="${selected}" aria-label="${e(tx('paSitePostTabAria', { n, title }))}. ${e(meta)}"><span class="taskplugin-page-advisor-post-tab-title">${e(title)}</span><span class="taskplugin-page-advisor-post-tab-meta">${e(meta)}</span></button>
      <button type="button" class="taskplugin-btn taskplugin-page-advisor-site-dismiss" data-sid="${e(id)}" data-tenant="${tenant}">${tx('paDismiss')}</button>
      <button type="button" class="taskplugin-btn taskplugin-btn-primary taskplugin-page-advisor-site-confirm" data-sid="${e(id)}" data-tenant="${tenant}">${tx('paConfirmRun')}</button>
    </div>`;
  }).join('');
}

/**
 * Count pill on the 智能体建议 tab. Zero hides it.
 * @param {unknown} count
 * @returns {{ visible: boolean, text: string }}
 */
function agentSuggestionTabBadge(count) {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n <= 0) return { visible: false, text: '' };
  return { visible: true, text: String(n) };
}

/**
 * Lookup key for the agent-suggestions list.
 * Query and fragment stay only when includeQuery is true. Host is unchanged.
 * @param {string} rawUrl
 * @param {boolean} includeQuery
 * @returns {string}
 */
/**
 * URL box in front of 查询. Blank uses the active tab. A typed value must be http(s).
 * A host without a scheme is treated as https.
 * @param {string} typed
 * @param {string} activeTabUrl
 * @returns {{ ok: true, source: 'active-tab'|'typed', url: string } | { ok: false, reason: 'invalid-url' }}
 */
function resolveAgentSuggestionLookupUrl(typed, activeTabUrl) {
  const raw = String(typed || '').trim();
  const fallback = String(activeTabUrl || '').trim();
  if (!raw) return { ok: true, source: 'active-tab', url: fallback };
  let candidate = raw;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (_err) {
    return { ok: false, reason: 'invalid-url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'invalid-url' };
  }
  const host = String(parsed.hostname || '');
  if (!host || (host !== 'localhost' && !host.includes('.'))) {
    return { ok: false, reason: 'invalid-url' };
  }
  return { ok: true, source: 'typed', url: parsed.href };
}

function pageUrlForAgentSuggestions(rawUrl, includeQuery) {
  const raw = String(rawUrl || '').trim();
  if (!raw || includeQuery === true) return raw;
  try {
    const parsed = new URL(raw);
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch (_err) {
    return raw;
  }
}

const PageAdvisorSitePending = {
  parseSitePendingItems,
  filterSitePendingOnly,
  tenantIdsForSitePending,
  shouldFetchSitePending,
  isSkippableNavigationUrl,
  sitePendingPostLabel,
  sitePendingPostMeta,
  pickSitePendingPostId,
  sitePendingPostsAfterMark,
  nextSitePendingPageAction,
  buildSitePendingTabsHtml,
  pageUrlForAgentSuggestions,
  resolveAgentSuggestionLookupUrl,
  agentSuggestionTabBadge,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorSitePending;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorSitePending = PageAdvisorSitePending;
}
}
