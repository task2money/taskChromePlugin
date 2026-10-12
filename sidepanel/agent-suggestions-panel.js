/**
 * 侧边栏「智能体建议」：只放建议贴。点选后让当前页切换显示这一条建议。
 */
(function initAgentSuggestionsPanel(global) {
  'use strict';

  var posts = [];
  var activeId = '';
  var pageShownId = '';
  var confirmGuard = global.ClickGuard && ClickGuard.createClickGuard
    ? ClickGuard.createClickGuard({ debounceMs: 400 })
    : null;
  var dismissGuard = global.ClickGuard && ClickGuard.createClickGuard
    ? ClickGuard.createClickGuard({ debounceMs: 300 })
    : null;

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  var INCLUDE_QUERY_KEY = 'agentSuggestionsIncludeQuery';
  var lookupSource = 'active-tab';

  function statusEl() {
    return document.getElementById('sp-agent-status');
  }

  function includeQueryBox() {
    return document.getElementById('sp-agent-include-query');
  }

  async function readIncludeQuery() {
    try {
      const got = await chrome.storage.local.get(INCLUDE_QUERY_KEY);
      return got && got[INCLUDE_QUERY_KEY] === true;
    } catch (_err) {
      return false;
    }
  }

  async function bindIncludeQuery() {
    const box = includeQueryBox();
    if (!box) return;
    box.checked = await readIncludeQuery();
    if (box.dataset.bound === '1') return;
    box.dataset.bound = '1';
    box.addEventListener('change', async () => {
      // Anti-Replay-OK: local lookup preference; re-reads the pending list
      await chrome.storage.local.set({ [INCLUDE_QUERY_KEY]: box.checked === true });
      await refresh();
      const target = lookupTarget();
      if (target.ok && target.source !== 'typed') {
        chrome.runtime.sendMessage({ action: 'refreshSitePendingForActiveTab' }).catch(() => {});
      }
    });
  }

  function render() {
    const host = document.getElementById('sp-agent-posts');
    const body = document.getElementById('sp-agent-body');
    const status = statusEl();
    const Pending = global.PageAdvisorSitePending;
    if (!host || !Pending) return;
    if (!posts.length) {
      host.innerHTML = '';
      if (body) body.innerHTML = '';
      if (status && !status.textContent) status.textContent = tx('agentSuggestionsEmpty');
      return;
    }
    if (status) status.textContent = '';
    host.innerHTML = Pending.buildSitePendingTabsHtml(posts, activeId, esc);
    if (body) body.innerHTML = '';
    bind(host);
  }

  function notifyPageSelection(postId) {
    if (lookupSource === 'typed') return;
    const id = String(postId || '');
    const post = posts.find((item) => String(item.id) === id) || null;
    pageShownId = id;
    chrome.runtime.sendMessage({
      action: 'selectAgentSuggestionPost',
      postId: id,
      item: post,
      applyToPage: true,
    }).catch(() => {});
  }

  function bind(host) {
    host.querySelectorAll('.taskplugin-page-advisor-post-tab-select').forEach((btn) => {
      btn.addEventListener('click', () => {
        // Anti-Replay-OK: local view switch between saved suggestion posts; no write
        const id = String(btn.getAttribute('data-post-id') || '');
        if (!id) return;
        const changed = id !== activeId;
        activeId = id;
        if (changed) render();
        notifyPageSelection(id);
      });
    });
    host.querySelectorAll('.taskplugin-page-advisor-site-confirm').forEach((btn) => {
      btn.addEventListener('click', () => { mark('confirm', btn); });
    });
    host.querySelectorAll('.taskplugin-page-advisor-site-dismiss').forEach((btn) => {
      btn.addEventListener('click', () => { mark('dismiss', btn); });
    });
  }

  async function mark(action, btn) {
    const guard = action === 'confirm' ? confirmGuard : dismissGuard;
    const sid = String(btn.getAttribute('data-sid') || '').trim();
    const tenantId = String(btn.getAttribute('data-tenant') || '').trim();
    if (!guard || !sid || !tenantId) return;
    await guard.run(async (ctx) => {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      const resp = await chrome.runtime.sendMessage({
        action: action === 'confirm'
          ? 'confirmSitePendingSuggestion'
          : 'dismissSitePendingSuggestion',
        tenantId,
        suggestionId: sid,
        idempotencyKey: ctx.idempotencyKey,
      });
      btn.disabled = false;
      btn.setAttribute('aria-busy', 'false');
      const status = statusEl();
      if (!resp || !resp.success) {
        if (status) {
          status.textContent = (resp && resp.error) || tx(action === 'confirm' ? 'paSiteConfirmFail' : 'paSiteRejectFail');
        }
        return;
      }
      const Pending = global.PageAdvisorSitePending;
      const shown = pageShownId;
      posts = Pending.sitePendingPostsAfterMark(posts, sid);
      activeId = Pending.pickSitePendingPostId(posts, activeId);
      if (status) status.textContent = '';
      syncBadge(posts.length);
      render();
      if (shown && shown === sid) notifyPageSelection(activeId);
      chrome.runtime.sendMessage({ action: 'refreshSitePendingForActiveTab' }).catch(() => {});
    });
  }

  function syncBadge(count) {
    if (typeof global.applyAgentSuggestionBadge === 'function') {
      global.applyAgentSuggestionBadge(count);
    }
  }

  function applyItems(resp) {
    const status = statusEl();
    if (!resp || resp.success === false || resp.ok === false) {
      posts = [];
      syncBadge(0);
      if (status) {
        status.textContent = (resp && resp.error) || tx('agentSuggestionsLoadFail');
        const traceId = String((resp && (resp.traceId || resp.trace_id)) || '').trim();
        if (traceId) status.setAttribute('data-traceId', traceId);
        else status.removeAttribute('data-traceId');
      }
      render();
      return;
    }
    if (resp.reason === 'not_logged_in') {
      posts = [];
      activeId = '';
      const host = document.getElementById('sp-agent-posts');
      const body = document.getElementById('sp-agent-body');
      if (host) host.innerHTML = '';
      if (body) body.innerHTML = '';
      syncBadge(0);
      if (status) status.textContent = tx('agentSuggestionsLogin');
      return;
    }
    posts = Array.isArray(resp.items) ? resp.items : [];
    const Pending = global.PageAdvisorSitePending;
    activeId = Pending ? Pending.pickSitePendingPostId(posts, activeId) : '';
    syncBadge(posts.length);
    if (status) {
      const emptyKey = lookupSource === 'typed' ? 'agentSuggestionsEmptyUrl' : 'agentSuggestionsEmpty';
      status.textContent = posts.length ? '' : tx(emptyKey);
    }
    render();
  }

  function urlInput() {
    return document.getElementById('sp-agent-url');
  }

  function typedUrlRaw() {
    const input = urlInput();
    return input ? String(input.value || '') : '';
  }

  function lookupTarget() {
    const Pending = global.PageAdvisorSitePending;
    if (Pending && typeof Pending.resolveAgentSuggestionLookupUrl === 'function') {
      return Pending.resolveAgentSuggestionLookupUrl(typedUrlRaw(), '');
    }
    const raw = typedUrlRaw().trim();
    return raw
      ? { ok: true, source: 'typed', url: raw }
      : { ok: true, source: 'active-tab', url: '' };
  }

  function bindUrlInput() {
    const input = urlInput();
    const btn = document.getElementById('sp-agent-query');
    if (!input || input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    input.addEventListener('keydown', (ev) => {
      // Anti-Replay-OK: read-only lookup; the query button busy flag blocks a second click
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      if (btn) btn.click();
    });
  }

  async function refresh(opts) {
    await bindIncludeQuery();
    bindQueryButton();
    bindUrlInput();
    const status = statusEl();
    const target = lookupTarget();
    if (!target.ok) {
      if (status) {
        status.textContent = tx('agentSuggestionsInvalidUrl');
        status.removeAttribute('data-traceId');
      }
      return;
    }
    lookupSource = target.source;
    const notifyPage = !!(opts && opts.notifyPage) && target.source !== 'typed';
    const message = {
      action: notifyPage ? 'refreshSitePendingForActiveTab' : 'listSitePendingForActiveTab',
    };
    if (target.source === 'typed') message.pageUrl = target.url;
    let resp;
    try {
      resp = await chrome.runtime.sendMessage(message);
    } catch (e) {
      posts = [];
      syncBadge(0);
      if (status) status.textContent = tx('agentSuggestionsLoadFail');
      return;
    }
    applyItems(resp || {});
  }

  function bindQueryButton() {
    const btn = document.getElementById('sp-agent-query');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      // Anti-Replay-OK: read-only lookup of pending suggestions for the active tab
      if (btn.dataset.busy === '1') return;
      btn.dataset.busy = '1';
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      try {
        await refresh({ notifyPage: true });
      } finally {
        btn.dataset.busy = '0';
        btn.disabled = false;
        btn.setAttribute('aria-busy', 'false');
      }
    });
  }

  bindQueryButton();

  global.AgentSuggestionsPanel = {
    refresh,
    applyListed(message) {
      if (typedUrlRaw().trim()) return;
      lookupSource = 'active-tab';
      applyItems(Object.assign({ success: true }, message || {}));
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
