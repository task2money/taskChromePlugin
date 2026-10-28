/**
 * 匿名试用优化贴的本地访问入口（v233）。
 *
 * 未登录生成建议时，服务端把帖子落进系统项目，只把「帖 id + 只读令牌」随响应交给插件。
 * 令牌只在这一次响应里出现，刷新页面就再也拿不到——不放本地，帖子等于一次性的。
 * 故这里按「去参数的网址」存下访问入口与展示快照：侧栏与页面列表都从这里恢复。
 *
 * 约束：
 *  - 只进 chrome.storage.local（不随账号同步，也不出扩展）；
 *  - 令牌只用于读回/领取，绝不打日志、不回传页面；
 *  - 上限 MAX_ENTRIES 条，过期即清；领取成功、404、410 一律删掉入口。
 */

'use strict';

const PageAdvisorAnonPosts = (() => {
  const STORAGE_KEY = 'pa_anon_posts_v1';
  const MAX_ENTRIES = 50;
  /** 快照只留能再次定位的字段；整页 HTML 片段不落盘。 */
  const SUGGESTION_FIELDS = [
    'id', 'title', 'summary', 'detail',
    'dom_id', 'testid', 'css_path', 'visible_text', 'anchor_text', 'landmark',
  ];
  const FIELD_MAX_CHARS = 300;

  function clip(value, max = FIELD_MAX_CHARS) {
    const text = String(value ?? '');
    return text.length > max ? text.slice(0, max) : text;
  }

  /**
   * 与生成/查询同口径：去掉查询串与片段。
   * @param {unknown} rawUrl
   * @returns {string}
   */
  function canonicalPageUrl(rawUrl) {
    const raw = String(rawUrl || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      parsed.search = '';
      parsed.hash = '';
      return parsed.href;
    } catch (_err) {
      return raw;
    }
  }

  function toTimeMs(value) {
    const ms = Date.parse(String(value || ''));
    return Number.isNaN(ms) ? 0 : ms;
  }

  function nowValue(nowMs) {
    const n = Number(nowMs);
    return Number.isFinite(n) && n > 0 ? n : Date.now();
  }

  function slimSuggestions(list) {
    return (Array.isArray(list) ? list : [])
      .filter((row) => row && typeof row === 'object')
      .map((row) => {
        const out = {};
        for (const field of SUGGESTION_FIELDS) {
          const value = String(row[field] ?? '').trim();
          if (value) out[field] = clip(value);
        }
        return out;
      });
  }

  /**
   * @param {object|null|undefined} raw
   * @returns {object|null}
   */
  function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const postId = String(raw.post_id || raw.postId || '').trim();
    const viewToken = String(raw.view_token || raw.viewToken || '').trim();
    const pageUrl = canonicalPageUrl(raw.page_url || raw.pageUrl || '');
    if (!postId || !viewToken || !pageUrl) return null;
    return {
      post_id: postId,
      view_token: viewToken,
      page_url: pageUrl,
      expires_at: String(raw.expires_at || raw.expiresAt || ''),
      created_at: String(raw.created_at || raw.createdAt || ''),
      title: clip(raw.title),
      summary: clip(raw.summary),
      detail: clip(raw.detail, 2000),
      prompt_tendency: String(raw.prompt_tendency || raw.promptTendency || '').trim(),
      claim_status: String(raw.claim_status || raw.claimStatus || 'open').trim() || 'open',
      suggestions: slimSuggestions(raw.suggestions),
    };
  }

  /** @param {object|null|undefined} entry */
  function isExpired(entry, nowMs) {
    const at = toTimeMs(entry?.expires_at);
    return at > 0 && at <= nowValue(nowMs);
  }

  /**
   * 写入一条入口：同 id 覆盖、过期清掉、最多留 MAX_ENTRIES 条（最旧的先出）。
   * @param {object[]} list
   * @param {object|null} entry
   * @param {number} [nowMs]
   * @returns {object[]}
   */
  function upsertEntry(list, entry, nowMs) {
    const clean = normalizeEntry(entry);
    const now = nowValue(nowMs);
    const kept = (Array.isArray(list) ? list : [])
      .map(normalizeEntry)
      .filter((row) => row && !isExpired(row, now) && (!clean || row.post_id !== clean.post_id));
    if (clean && !isExpired(clean, now)) {
      if (!clean.created_at) clean.created_at = new Date(now).toISOString();
      kept.push(clean);
    }
    kept.sort((a, b) => {
      const diff = toTimeMs(a.created_at) - toTimeMs(b.created_at);
      return diff !== 0 ? diff : String(a.post_id).localeCompare(String(b.post_id));
    });
    return kept.slice(Math.max(0, kept.length - MAX_ENTRIES));
  }

  /**
   * @param {object[]} list
   * @param {string} postId
   * @returns {object[]}
   */
  function removeEntry(list, postId) {
    const id = String(postId || '').trim();
    if (!id) return Array.isArray(list) ? list.slice() : [];
    return (Array.isArray(list) ? list : []).filter((row) => String(row?.post_id || '') !== id);
  }

  /**
   * 某一页还有效的匿名入口（按写入先后）。
   * @param {object[]} list
   * @param {string} pageUrl
   * @param {number} [nowMs]
   * @returns {object[]}
   */
  function entriesForPageUrl(list, pageUrl, nowMs) {
    const url = canonicalPageUrl(pageUrl);
    if (!url) return [];
    const now = nowValue(nowMs);
    return (Array.isArray(list) ? list : [])
      .map(normalizeEntry)
      .filter((row) => row && row.page_url === url && !isExpired(row, now));
  }

  /**
   * 侧栏/页面列表用的是「建议贴」条目，匿名入口要映射成同一种形状。
   * @param {object} entry
   * @returns {object|null}
   */
  function itemFromEntry(entry) {
    const row = normalizeEntry(entry);
    if (!row) return null;
    return {
      id: row.post_id,
      post_id: row.post_id,
      title: row.title,
      summary: row.summary,
      detail: row.detail,
      suggestions: row.suggestions,
      prompt_tendency: row.prompt_tendency,
      confirm_status: 'pending',
      created_at: row.created_at,
      owner_kind: 'anonymous',
      claim_status: row.claim_status,
      page_url: row.page_url,
      expires_at: row.expires_at,
      view_token: row.view_token,
      tenant_id: '',
      anonymous: true,
    };
  }

  /**
   * 试用成功时落一条本地入口：服务端给的 id/令牌 + 本端建议快照。
   * @param {{ post?: object|null, pageUrl?: string, pageTitle?: string,
   *   suggestions?: object[], copy?: { title?: string, summary?: string, detail?: string },
   *   promptTendency?: string, nowMs?: number }} input
   * @returns {object|null}
   */
  function entryFromTrialPost(input = {}) {
    const post = input.post && typeof input.post === 'object' ? input.post : {};
    const postId = String(post.post_id || '').trim();
    const viewToken = String(post.view_token || '').trim();
    const pageUrl = canonicalPageUrl(post.page_url || input.pageUrl);
    if (!postId || !viewToken || !pageUrl) return null;
    const copy = input.copy && typeof input.copy === 'object' ? input.copy : {};
    const suggestions = Array.isArray(input.suggestions) ? input.suggestions : [];
    const first = suggestions[0] || {};
    const title = String(copy.title || first.title || input.pageTitle || '').trim();
    return normalizeEntry({
      post_id: postId,
      view_token: viewToken,
      page_url: pageUrl,
      expires_at: String(post.expires_at || ''),
      created_at: new Date(nowValue(input.nowMs)).toISOString(),
      title,
      summary: String(copy.summary || first.summary || '').trim(),
      detail: String(copy.detail || first.detail || '').trim(),
      prompt_tendency: String(input.promptTendency || '').trim(),
      claim_status: 'open',
      suggestions,
    });
  }

  /**
   * 服务端读回的真身覆盖本地快照（标题/建议以服务端为准）。
   * @param {object|null} entry
   * @param {object|null} view
   * @returns {object|null}
   */
  function entryFromPublicView(entry, view) {
    const base = normalizeEntry(entry);
    if (!base || !view || typeof view !== 'object') return base;
    return normalizeEntry({
      ...base,
      title: view.title || base.title,
      summary: view.summary ?? base.summary,
      detail: view.detail ?? base.detail,
      prompt_tendency: view.prompt_tendency || base.prompt_tendency,
      claim_status: view.claim_status || base.claim_status,
      created_at: view.created_at || base.created_at,
      expires_at: view.expires_at || base.expires_at,
      suggestions: Array.isArray(view.suggestions) && view.suggestions.length
        ? view.suggestions
        : base.suggestions,
    });
  }

  function resolveStorage(storage) {
    if (storage && typeof storage.get === 'function' && typeof storage.set === 'function') {
      return storage;
    }
    const local = typeof chrome !== 'undefined' && chrome?.storage?.local ? chrome.storage.local : null;
    return local && typeof local.get === 'function' && typeof local.set === 'function' ? local : null;
  }

  /** 读改写串行化：并发的列表刷新与领取不会互相覆盖。 */
  let writeChain = Promise.resolve();
  function withWriteLock(fn) {
    const next = writeChain.then(fn, fn);
    writeChain = next.then(() => {}, () => {});
    return next;
  }

  /**
   * @param {object|null} [storage]
   * @returns {Promise<object[]>}
   */
  async function loadEntries(storage) {
    const store = resolveStorage(storage);
    if (!store) return [];
    try {
      const got = await store.get(STORAGE_KEY);
      const raw = Array.isArray(got?.[STORAGE_KEY]) ? got[STORAGE_KEY] : [];
      return raw.map(normalizeEntry).filter(Boolean);
    } catch (e) {
      console.warn('[taskChromePlugin] anon posts load:', e?.message || e);
      return [];
    }
  }

  async function saveEntries(storage, list) {
    const store = resolveStorage(storage);
    if (!store) return false;
    try {
      await store.set({ [STORAGE_KEY]: Array.isArray(list) ? list : [] });
      return true;
    } catch (e) {
      console.warn('[taskChromePlugin] anon posts save:', e?.message || e);
      return false;
    }
  }

  /**
   * 写入一条入口并顺手清掉过期项。
   * @returns {Promise<object|null>} 落盘的入口（被拒/过期时为 null）
   */
  function rememberEntry(storage, entry, nowMs) {
    const clean = normalizeEntry(entry);
    return withWriteLock(async () => {
      const list = await loadEntries(storage);
      const next = upsertEntry(list, clean, nowMs);
      const ok = await saveEntries(storage, next);
      if (!ok || !clean) return null;
      return next.find((row) => row.post_id === clean.post_id) || null;
    });
  }

  /**
   * @returns {Promise<boolean>} 是否真的删掉了一条
   */
  function forgetEntry(storage, postId) {
    return withWriteLock(async () => {
      const list = await loadEntries(storage);
      const next = removeEntry(list, postId);
      if (next.length === list.length) return false;
      await saveEntries(storage, next);
      return true;
    });
  }

  /**
   * @returns {Promise<object[]>}
   */
  async function listEntriesForPageUrl(storage, pageUrl, nowMs) {
    return entriesForPageUrl(await loadEntries(storage), pageUrl, nowMs);
  }

  return {
    STORAGE_KEY,
    MAX_ENTRIES,
    canonicalPageUrl,
    normalizeEntry,
    isExpired,
    upsertEntry,
    removeEntry,
    entriesForPageUrl,
    itemFromEntry,
    entryFromTrialPost,
    entryFromPublicView,
    loadEntries,
    rememberEntry,
    forgetEntry,
    listEntriesForPageUrl,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorAnonPosts;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorAnonPosts = PageAdvisorAnonPosts;
}
