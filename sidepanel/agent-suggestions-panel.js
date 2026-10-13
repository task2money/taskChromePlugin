/**
 * 侧边栏「智能体建议」：只放当前网页的建议贴，并按需为当前网页生成一条。
 *
 * 列表固定跟随当前网页（不再有网址框与查询按钮，ADR-0167）。用户能选的是
 * 提示词（本机 prompt skills 多选一），点「给当前网页生成建议」后由后台生成并
 * 落到域名所属项目（没绑定则默认项目），落点项目名由后台回报。
 */
(function initAgentSuggestionsPanel(global) {
  'use strict';

  var posts = [];
  var activeId = '';
  var siteBaseUrl = '';
  var pageShownId = '';
  // 与下拉菜单同源的技能缓存，供点击生成时同步取用（见 bindPromptSelect）。
  var skillList = [];
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

  function statusEl() {
    return document.getElementById('sp-agent-status');
  }

  function promptSelect() {
    return document.getElementById('sp-agent-prompt');
  }

  function generateButton() {
    return document.getElementById('sp-agent-generate');
  }

  function setStatus(text, traceId) {
    const status = statusEl();
    if (!status) return;
    status.textContent = text || '';
    const tid = String(traceId || '').trim();
    if (tid) status.setAttribute('data-traceId', tid);
    else status.removeAttribute('data-traceId');
  }

  function render() {
    const host = document.getElementById('sp-agent-posts');
    const body = document.getElementById('sp-agent-body');
    if (!host) return;
    const Pending = global.PageAdvisorSitePending;
    if (!Pending || !posts.length) {
      host.innerHTML = '';
      if (body) body.innerHTML = '';
      if (!posts.length) setStatus(tx('agentSuggestionsEmpty'));
      return;
    }
    setStatus('');
    host.innerHTML = Pending.buildSitePendingTabsHtml(posts, activeId, esc, siteBaseUrl);
    if (body) body.innerHTML = '';
    bind(host);
  }

  function notifyPageSelection(postId) {
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
      if (!resp || !resp.success) {
        setStatus((resp && resp.error) || tx(action === 'confirm' ? 'paSiteConfirmFail' : 'paSiteRejectFail'));
        return;
      }
      const Pending = global.PageAdvisorSitePending;
      const shown = pageShownId;
      posts = Pending.sitePendingPostsAfterMark(posts, sid);
      activeId = Pending.pickSitePendingPostId(posts, activeId);
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
    if (!resp || resp.success === false || resp.ok === false) {
      posts = [];
      syncBadge(0);
      setStatus((resp && resp.error) || tx('agentSuggestionsLoadFail'),
        resp && (resp.traceId || resp.trace_id));
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
      setStatus(tx('agentSuggestionsLogin'));
      return;
    }
    posts = Array.isArray(resp.items) ? resp.items : [];
    const Pending = global.PageAdvisorSitePending;
    activeId = Pending ? Pending.pickSitePendingPostId(posts, activeId) : '';
    syncBadge(posts.length);
    render();
  }

  async function loadPromptStore() {
    const Skills = global.PageAdvisorPromptSkills;
    if (!Skills || typeof Skills.loadFromStorage !== 'function') {
      return { skills: [], activeSkillId: '' };
    }
    try {
      return await Skills.loadFromStorage();
    } catch (e) {
      console.warn('[taskChromePlugin] load prompt skills:', e?.message || e);
      return { skills: [], activeSkillId: '' };
    }
  }

  function plainSkillOptions(skills) {
    return skills.map((s) => `<option value="${esc(s.id)}">${esc(s.title || s.id)}</option>`).join('');
  }

  /**
   * 选择不落盘：这是「这一次生成用哪条提示词」，与工作空间级激活技能
   * （PageAdvisorPromptSkills 的 activeSkillId，ALT+Z 直连用）是两回事。
   */
  async function bindPromptSelect() {
    const sel = promptSelect();
    if (!sel) return;
    const store = await loadPromptStore();
    const skills = (Array.isArray(store?.skills) ? store.skills : []).filter((s) => s && s.id);
    const active = String(store?.activeSkillId || '');
    const keep = sel.value || active;
    sel.innerHTML = `<option value="">${esc(tx('agentSuggestionsPromptDefault'))}</option>`
      + plainSkillOptions(skills);
    sel.value = skills.some((s) => s.id === keep) ? keep : '';
    // 点生成时要同步拿到技能正文与倾向，故随下拉一起缓存，别在点击里再读一次 storage。
    skillList = skills;
  }

  function bindGenerateButton() {
    const btn = generateButton();
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => generate());
  }

  async function generate() {
    const btn = generateButton();
    if (!btn || btn.dataset.busy === '1') return;
    const sel = promptSelect();
    const skillId = String((sel && sel.value) || '').trim();
    const skill = skillList.find((s) => s && String(s.id) === skillId) || null;

    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    setStatus(tx('agentSuggestionsGenerating'));
    try {
      // Anti-Replay-OK: 生成由后台带 Idempotency-Key 发一次；这里只挡住重复点击
      const resp = await chrome.runtime.sendMessage({
        action: 'generateAgentSuggestionsForActiveTab',
        skillId: skill ? String(skill.id) : '',
        promptTendency: skill ? String(skill.tendency || '') : '',
      });
      if (!resp || resp.success === false) {
        setStatus((resp && resp.error) || tx('agentSuggestionsGenerateFail'), resp && resp.traceId);
        return;
      }
      await refresh();
      if (resp.postId) {
        activeId = String(resp.postId);
        render();
        notifyPageSelection(activeId);
      }
      const project = String(resp.projectName || '').trim();
      setStatus(tx(resp.created === false ? 'agentSuggestionsPostedExisting' : 'agentSuggestionsGeneratedInto',
        project ? { project } : ''));
    } catch (e) {
      setStatus(e?.message || tx('agentSuggestionsGenerateFail'));
    } finally {
      btn.dataset.busy = '0';
      btn.disabled = false;
      btn.setAttribute('aria-busy', 'false');
    }
  }

  function rememberSiteBase() {
    if (!global.Storage || typeof global.Storage.getApiConfig !== 'function') return Promise.resolve();
    return global.Storage.getApiConfig().then((cfg) => {
      siteBaseUrl = String((cfg && cfg.baseUrl) || '');
    }).catch(() => {});
  }

  /**
   * 拉当前网页的建议贴。`notifyPage` 为真时顺带让页面浮层也重拉
   * （标记了一帖之后页面列表要跟着少一行）。
   */
  async function refresh(opts) {
    await rememberSiteBase();
    await bindPromptSelect();
    bindGenerateButton();
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        action: (opts && opts.notifyPage) ? 'refreshSitePendingForActiveTab' : 'listSitePendingForActiveTab',
      });
    } catch (_e) {
      posts = [];
      syncBadge(0);
      setStatus(tx('agentSuggestionsLoadFail'));
      return;
    }
    applyItems(resp || {});
  }

  bindGenerateButton();

  global.AgentSuggestionsPanel = {
    refresh,
    applyListed(message) {
      rememberSiteBase().then(() => {
        applyItems(Object.assign({ success: true }, message || {}));
      });
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
