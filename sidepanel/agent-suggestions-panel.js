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
  // 匿名试用的结果只活在这一次面板会话里；列表刷新（登录态）时要收起。
  var trialShown = false;
  var trialHintSeq = 0;
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

  function reloadRetryButton() {
    return document.getElementById('sp-agent-reload-retry');
  }

  /**
   * 只有「刷新页面可能修好」的失败才露出这个入口：页面类型本身不支持（chrome:// 等）
   * 刷新也无用，给出按钮等于给死路。
   */
  function setReloadRetryVisible(visible) {
    const btn = reloadRetryButton();
    if (btn) btn.hidden = !visible;
  }

  function setStatus(text, traceId) {
    const status = statusEl();
    if (!status) return;
    status.textContent = text || '';
    const tid = String(traceId || '').trim();
    if (tid) status.setAttribute('data-traceId', tid);
    else status.removeAttribute('data-traceId');
  }

  /** 试用额度的状态行：本地化重置时间，并区分「用完了」与「试用暂停」。 */
  function trialResetLabel(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) return raw;
    try {
      return at.toLocaleString(undefined, {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      });
    } catch (_) {
      return raw;
    }
  }

  function trialQuotaStatus(quota) {
    if (!quota || quota.enabled === false) return tx('paTrialPaused');
    const remaining = Number(quota.remaining);
    const total = Number(quota.daily_quota);
    const resetsAt = trialResetLabel(quota.resets_at);
    if (Number.isFinite(remaining) && remaining <= 0) {
      return tx('paTrialQuotaExhausted', { resetsAt });
    }
    return tx('paTrialRemaining', {
      n: Number.isFinite(remaining) ? remaining : 0,
      total: Number.isFinite(total) ? total : 0,
      resetsAt,
    });
  }

  /** 试用结果只渲染在侧栏，不生成优化贴，也不替换页面建议列表。 */
  function renderTrialSuggestions(resp) {
    const host = document.getElementById('sp-agent-posts');
    const body = document.getElementById('sp-agent-body');
    if (host) host.innerHTML = '';
    trialShown = true;
    trialHintSeq += 1;
    if (!body) return;
    const list = (Array.isArray(resp && resp.suggestions) ? resp.suggestions : []).filter(Boolean);
    if (!list.length) {
      body.innerHTML = '';
      return;
    }
    const items = list.map((s, i) => {
      const title = String(s?.title || '').trim();
      const text = [String(s?.summary || '').trim(), String(s?.detail || '').trim()]
        .filter(Boolean)
        .join(' — ');
      return `<li data-testid="sp-agent-trial-suggestion-${i}"><strong>${esc(title)}</strong>`
        + (text ? `<span>${esc(text)}</span>` : '')
        + '</li>';
    }).join('');
    body.innerHTML = `<div class="sp-agent-trial" data-testid="sp-agent-trial">`
      + `<p class="hint" data-testid="sp-agent-trial-notice">${esc(tx('agentSuggestionsTrialNotice'))}</p>`
      + `<ol class="sp-agent-suggestions">${items}</ol></div>`;
  }

  /** 未登录时读一次今日剩余额度；只读接口，不消耗次数。 */
  async function loadTrialQuotaHint() {
    if (!global.chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') return;
    const seq = ++trialHintSeq;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'getPageTrialQuota' });
      if (seq !== trialHintSeq || trialShown || posts.length) return;
      if (!resp || resp.success === false || !resp.quota) return;
      setStatus(trialQuotaStatus(resp.quota));
    } catch (_e) { /* 额度提示失败不影响列表与生成 */ }
  }

  function render() {
    const host = document.getElementById('sp-agent-posts');
    const body = document.getElementById('sp-agent-body');
    if (!host) return;
    const Pending = global.PageAdvisorSitePending;
    if (!Pending || !posts.length) {
      host.innerHTML = '';
      if (body) body.innerHTML = '';
      trialShown = false;
      if (!posts.length) setStatus(tx('agentSuggestionsEmpty'));
      return;
    }
    trialShown = false;
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
      // 未登录不再是一堵墙：提示可走每日试用，额度到了再覆盖成「还剩 N 次」。
      setStatus(tx('agentSuggestionsTrialHint'));
      loadTrialQuotaHint();
      return;
    }
    posts = Array.isArray(resp.items) ? resp.items : [];
    const Pending = global.PageAdvisorSitePending;
    activeId = Pending ? Pending.pickSitePendingPostId(posts, activeId) : '';
    syncBadge(posts.length);
    render();
  }

  /**
   * 本机文档空着时补上系统预埋，否则下拉只剩「默认提示词」一项，等于没得选。
   * 必须落盘：生成时后台按 id 回本机文档取正文（sw-agent-suggestions.js），
   * 只在下拉里显示而不落盘的项，选中后会悄悄退回默认提示词。
   * 本机已有条目就交给 popup 的目录同步去做，这里不抢。
   */
  async function seedSystemCatalog(store) {
    const Skills = global.PageAdvisorPromptSkills;
    if (!Skills || typeof Skills.applySystemCatalogDefault !== 'function') return store;
    if (Array.isArray(store?.skills) && store.skills.length) return store;
    try {
      const lastWs = global.Storage && typeof global.Storage.getLastWorkspace === 'function'
        ? String(await global.Storage.getLastWorkspace() || '').trim()
        : '';
      const rec = Skills.applySystemCatalogDefault(
        store,
        { skills: typeof Skills.bundledPresetSkills === 'function' ? Skills.bundledPresetSkills() : [] },
        lastWs || 'local',
      );
      if (rec?.action === 'applied' && typeof Skills.saveToStorage === 'function') {
        await Skills.saveToStorage(rec.store, global.Storage || null);
      }
      return rec?.store || store;
    } catch (e) {
      console.warn('[taskChromePlugin] seed prompt skills:', e?.message || e);
      return store;
    }
  }

  async function loadPromptStore() {
    const Skills = global.PageAdvisorPromptSkills;
    if (!Skills || typeof Skills.loadFromStorage !== 'function') {
      return { skills: [], activeSkillId: '' };
    }
    try {
      return await seedSystemCatalog(await Skills.loadFromStorage());
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

  function bindReloadRetryButton() {
    const btn = reloadRetryButton();
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => reloadAndRetry());
  }

  /**
   * 「刷新当前网页并重试」：刷新由后台执行（要等新 content script 注入完再回来），
   * 通道探通以后由这里重跑一次生成——生成本身在 generate()，不复制第二份。
   */
  async function reloadAndRetry() {
    const btn = reloadRetryButton();
    if (!btn || btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    btn.disabled = true;
    setStatus(tx('agentSuggestionsReloading'));
    try {
      // Anti-Replay-OK: 只由用户点击触发；刷新会丢页面未保存状态，绝不自动刷新
      const resp = await chrome.runtime.sendMessage({ action: 'reloadPageAndRetryAgentSuggestions' });
      if (!resp || resp.success === false) {
        setStatus((resp && resp.error) || tx('paContextUnreachable'));
        return;
      }
      setReloadRetryVisible(false);
      await generate();
    } catch (e) {
      setStatus(e?.message || tx('paContextUnreachable'));
    } finally {
      btn.dataset.busy = '0';
      btn.disabled = false;
    }
  }

  /**
   * 侧栏打开 / 切 tab 时先探一次采集通道（OPT-20261013-019）：通道坏了就直接把
   * 「刷新并重试」摆出来，省掉「先点生成 → 看到失败 → 再点刷新」那一轮。探不通就静默，
   * 生成失败那条路径仍会再报一次。
   */
  async function probeCaptureChannel() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'probeAgentSuggestionsChannel' });
      setReloadRetryVisible(!!(resp && resp.retryable));
    } catch (_e) { /* 探测失败不影响列表与生成 */ }
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
    setReloadRetryVisible(false);
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
        // 只有「刷新页面能修好」的那类失败才给一键入口。
        setReloadRetryVisible(resp && resp.errorCode === 'PAGE_CONTEXT_UNREACHABLE');
        return;
      }
      if (resp.trial) {
        renderTrialSuggestions(resp);
        setStatus(resp.quota ? trialQuotaStatus(resp.quota) : tx('agentSuggestionsTrialHint'));
        return;
      }
      trialShown = false;
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
    bindReloadRetryButton();
    // 探测不挡列表：等它回来再决定要不要露出刷新入口。
    probeCaptureChannel();
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
