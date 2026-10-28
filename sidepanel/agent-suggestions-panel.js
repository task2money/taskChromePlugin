/**
 * 侧边栏「智能体建议」：只放当前网页的建议贴，并按需为当前网页生成一条。
 *
 * 列表固定跟随当前网页（不再有网址框与查询按钮，ADR-0167）。用户能选的是
 * 提示词（服务端目录多选一，选中值记忆在 `pageAdvisorSelectedPromptId`），
 * 点「给当前网页生成建议」后由后台生成并落到域名所属项目（没绑定则默认项目），
 * 落点项目名由后台回报。
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
  // 下拉当前渲染的服务端条目：生成时只用它把选中项的 tendency 一并回传。
  var promptSkills = [];
  // 下拉加载序号：工作空间连续切换 / 重试时只认最后一次响应。
  var promptLoadSeq = 0;
  var promptWorkspaceListener = null;
  var confirmGuard = global.ClickGuard && ClickGuard.createClickGuard
    ? ClickGuard.createClickGuard({ debounceMs: 400 })
    : null;
  var dismissGuard = global.ClickGuard && ClickGuard.createClickGuard
    ? ClickGuard.createClickGuard({ debounceMs: 300 })
    : null;
  var claimGuard = global.ClickGuard && ClickGuard.createClickGuard
    ? ClickGuard.createClickGuard({ debounceMs: 400 })
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

  function promptStatusEl() {
    return document.getElementById('sp-agent-prompt-status');
  }

  function promptRetryButton() {
    return document.getElementById('sp-agent-prompt-retry');
  }

  function promptOptionsApi() {
    return global.PageAdvisorPromptOptions || null;
  }

  function setPromptStatus(text) {
    const el = promptStatusEl();
    if (el) el.textContent = text || '';
  }

  function setPromptRetryVisible(visible) {
    const btn = promptRetryButton();
    if (btn) btn.hidden = !visible;
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
    host.querySelectorAll('.taskplugin-page-advisor-site-claim').forEach((btn) => {
      btn.addEventListener('click', () => { claim(btn); });
    });
  }

  /** 未登录点「领取」：按弹窗同一条 OAuth 入口打开授权页。 */
  async function openClaimLogin() {
    try {
      const cfg = global.Storage && typeof global.Storage.getApiConfig === 'function'
        ? await global.Storage.getApiConfig()
        : null;
      const baseUrl = String(cfg?.baseUrl || '').trim();
      if (!baseUrl) return;
      await chrome.runtime.sendMessage({ action: 'oauthStart', baseUrl });
    } catch (e) {
      console.warn('[taskChromePlugin] claim login open failed:', e?.message || e);
    }
  }

  /**
   * 「领取任务贴」：把匿名帖归到登录用户名下（服务端复制到其落点项目）。
   * 令牌由后台按帖 id 从本地入口取，不进 DOM；成功后列表刷新成自己的帖子。
   */
  async function claim(btn) {
    const postId = String(btn.getAttribute('data-post-id') || '').trim();
    if (!claimGuard || !postId) return;
    await claimGuard.run(async () => {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      setStatus(tx('paSiteClaiming'));
      let resp = null;
      try {
        resp = await chrome.runtime.sendMessage({ action: 'claimPageTrialPost', postId });
      } catch (e) {
        setStatus(e?.message || tx('paSiteClaimFail'));
        btn.disabled = false;
        btn.setAttribute('aria-busy', 'false');
        return;
      }
      btn.disabled = false;
      btn.setAttribute('aria-busy', 'false');
      if (!resp || !resp.success) {
        // 未登录：领取需要归属到用户项目，直接把 OAuth 页打开（与弹窗同一入口）。
        if (resp && resp.errorCode === 'not_logged_in') {
          setStatus(tx('paSiteClaimLoginOpening'));
          await openClaimLogin();
          return;
        }
        setStatus((resp && resp.error) || tx('paSiteClaimFail'));
        // 入口已作废（错令牌 / 已被领取 / 已过期）：本地也删掉，别让死按钮留着。
        const status = Number(resp && resp.status);
        if (status === 404 || status === 410) {
          const Pending = global.PageAdvisorSitePending;
          posts = Pending ? Pending.sitePendingPostsAfterMark(posts, postId) : posts;
          activeId = Pending ? Pending.pickSitePendingPostId(posts, activeId) : activeId;
          syncBadge(posts.length);
          render();
        }
        return;
      }
      const project = String(resp.projectName || '').trim();
      setStatus(tx('paSiteClaimDone', project ? { project } : ''));
      chrome.runtime.sendMessage({ action: 'refreshSitePendingForActiveTab' }).catch(() => {});
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
    posts = Array.isArray(resp.items) ? resp.items : [];
    const Pending = global.PageAdvisorSitePending;
    activeId = Pending ? Pending.pickSitePendingPostId(posts, activeId) : '';
    syncBadge(posts.length);
    render();
    if (resp.reason === 'not_logged_in') {
      // 未登录不再是一堵墙：本机匿名优化贴照常列出，提示可走每日试用；
      // 有帖子时额度提示不抢占状态行（loadTrialQuotaHint 自带守卫）。
      setStatus(tx('agentSuggestionsTrialHint'));
      loadTrialQuotaHint();
    }
  }

  /** 默认项文案：有默认标题时「默认 · 标题」，目录没给标题时退回通用「默认提示词」。 */
  function promptDefaultLabel(defaultTitle) {
    const title = String(defaultTitle || '').trim();
    return title ? tx('paPromptDefaultOption', { title }) : tx('agentSuggestionsPromptDefault');
  }

  /** 选项正文：标题 + 审计/工作空间标记（`<option>` 只能放纯文本，标记拼进文案）。 */
  function promptOptionLabel(skill) {
    let label = String(skill.title || skill.id || '');
    if (String(skill.runtime || '') === 'audit') label += ' · ' + tx('paPromptAuditBadge');
    if (skill.readonly === false) label += ' · ' + tx('paPromptWorkspaceBadge');
    return label;
  }

  /**
   * 渲染服务端目录：首项是默认项（value=''），其余按服务端顺序，跳过与默认 id 重复的条目。
   * 只画元数据，提示词正文从不进入 DOM。
   */
  function renderPromptOptions(skills, defaultSkillId, defaultTitle) {
    const sel = promptSelect();
    if (!sel) return [];
    const list = (Array.isArray(skills) ? skills : [])
      .filter((skill) => skill && String(skill.id || '').trim());
    const defaultId = String(defaultSkillId || '').trim();
    const defaultSkill = list.find((skill) => String(skill.id) === defaultId) || null;
    const title = String(defaultTitle || '').trim() || String(defaultSkill?.title || '');
    const html = [`<option value="">${esc(promptDefaultLabel(title))}</option>`];
    list.forEach((skill) => {
      const id = String(skill.id).trim();
      if (defaultId && id === defaultId) return;
      html.push(`<option value="${esc(id)}">${esc(promptOptionLabel(skill))}</option>`);
    });
    sel.innerHTML = html.join('');
    promptSkills = list;
    return list;
  }

  async function readStoredPromptId() {
    const api = promptOptionsApi();
    if (!api || typeof api.loadSelectedId !== 'function') return '';
    try {
      return String(await api.loadSelectedId() || '').trim();
    } catch (_e) {
      return '';
    }
  }

  function persistPromptId(id) {
    const api = promptOptionsApi();
    if (!api || typeof api.saveSelectedId !== 'function') return;
    try {
      const pending = api.saveSelectedId(String(id || '').trim());
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch (_e) { /* 选择记忆失败不影响本次生成（仍按下拉当前值发） */ }
  }

  function bindPromptChange() {
    const sel = promptSelect();
    if (!sel || sel.dataset.promptBound === '1') return;
    sel.dataset.promptBound = '1';
    sel.addEventListener('change', () => {
      persistPromptId(sel.value);
    });
  }

  /**
   * 选中值取持久化记忆；记忆里的 id 不在新列表里时回落默认项并清掉记忆，
   * 免得用户以为选中了某条提示词、实际回传的是失效 id。
   * 默认 id 只由首项代表（它没有独立 option），因此也不属于「可选中项」。
   */
  function applyPromptSelection(sel, list, storedId, defaultSkillId) {
    if (!sel) return '';
    const defaultId = String(defaultSkillId || '').trim();
    const present = new Set((Array.isArray(list) ? list : [])
      .map((skill) => String(skill.id))
      .filter((id) => id && id !== defaultId));
    const current = String(sel.value || '').trim();
    const stored = String(storedId || '').trim();
    const keep = (current && present.has(current)) ? current
      : (stored && present.has(stored) ? stored : '');
    sel.value = keep;
    if (!keep && stored) persistPromptId('');
    return keep;
  }

  /**
   * 提示词下拉的数据源是后台消息 `loadPageAdvisorPromptOptions`（服务端目录）。
   * 加载失败只影响下拉：状态行报错 + 露出重试，列表与生成按钮照常可用。
   * 调用方不 await 本函数：目录要打网络，不能拖住建议列表。
   */
  async function bindPromptSelect() {
    const sel = promptSelect();
    if (!sel) return;
    bindPromptChange();
    const seq = ++promptLoadSeq;
    const stored = await readStoredPromptId();
    let resp = null;
    try {
      resp = await chrome.runtime.sendMessage({ action: 'loadPageAdvisorPromptOptions' });
    } catch (_e) {
      resp = null;
    }
    if (seq !== promptLoadSeq) return; // 工作空间连续切换 / 重试：只认最后一次响应
    if (!resp || resp.ok === false || resp.success === false) {
      renderPromptOptions([], '', '');
      setPromptStatus(tx('paPromptLoadFailed'));
      setPromptRetryVisible(true);
      return;
    }
    const list = renderPromptOptions(resp.skills, resp.defaultSkillId, resp.defaultTitle);
    applyPromptSelection(sel, list, stored, resp.defaultSkillId);
    setPromptStatus('');
    setPromptRetryVisible(false);
  }

  function bindPromptRetryButton() {
    const btn = promptRetryButton();
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => { bindPromptSelect().catch(() => {}); });
  }

  /** 工作空间切了，合并列表的缓存 key 也变了：先清缓存，再按新空间重拉。 */
  function resetPromptOptionsCache() {
    const api = promptOptionsApi();
    if (!api || typeof api.resetCache !== 'function') return;
    try { api.resetCache(); } catch (_e) { /* 清缓存失败不挡重拉 */ }
  }

  function removePromptWorkspaceListener() {
    if (!promptWorkspaceListener) return;
    try {
      if (global.chrome && chrome.storage && chrome.storage.onChanged
        && typeof chrome.storage.onChanged.removeListener === 'function') {
        chrome.storage.onChanged.removeListener(promptWorkspaceListener);
      }
    } catch (_e) { /* 卸载路径不抛 */ }
    promptWorkspaceListener = null;
  }

  /**
   * 工作空间切换（`lastWorkspaceId`）后提示词目录跟着换：清缓存并重拉。
   * 监听在页面 unload 时移除，避免扩展页销毁后仍留着回调。
   */
  function ensurePromptWorkspaceListener() {
    if (promptWorkspaceListener) return;
    if (!global.chrome || !chrome.storage || !chrome.storage.onChanged
      || typeof chrome.storage.onChanged.addListener !== 'function') return;
    promptWorkspaceListener = (changes, area) => {
      if (area && area !== 'local') return;
      if (!changes || !Object.prototype.hasOwnProperty.call(changes, 'lastWorkspaceId')) return;
      resetPromptOptionsCache();
      // Anti-Replay-OK: 只重读下拉数据源，不写 storage、不触发生成
      bindPromptSelect().catch(() => {});
    };
    chrome.storage.onChanged.addListener(promptWorkspaceListener);
    const target = typeof global.addEventListener === 'function'
      ? global
      : (global.window && typeof global.window.addEventListener === 'function' ? global.window : null);
    if (target) target.addEventListener('unload', removePromptWorkspaceListener);
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
    const selectedId = String((sel && sel.value) || '').trim();
    // 只回传当前列表里的 id：下拉值被外部写脏时按默认提示词处理。
    const skill = selectedId
      ? (promptSkills.find((s) => s && String(s.id) === selectedId) || null)
      : null;

    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    setReloadRetryVisible(false);
    setStatus(tx('agentSuggestionsGenerating'));
    try {
      // Anti-Replay-OK: 生成由后台带 Idempotency-Key 发一次；这里只挡住重复点击
      const resp = await chrome.runtime.sendMessage({
        action: 'generateAgentSuggestionsForActiveTab',
        promptSkillId: skill ? String(skill.id) : '',
        promptTendency: skill ? String(skill.tendency || '') : '',
      });
      if (!resp || resp.success === false) {
        setStatus((resp && resp.error) || tx('agentSuggestionsGenerateFail'), resp && resp.traceId);
        // 只有「刷新页面能修好」的那类失败才给一键入口。
        setReloadRetryVisible(resp && resp.errorCode === 'PAGE_CONTEXT_UNREACHABLE');
        return;
      }
      if (resp.trial) {
        // 落成匿名优化贴时与登录用户同形：列表里多一条帖子，选中即在页面显示；
        // 只有落贴失败（无 postId）才退回「只给即时建议」的旧形态。
        const anonymousPostId = String(resp.postId || '').trim();
        if (anonymousPostId) {
          trialShown = false;
          await refresh();
          activeId = anonymousPostId;
          render();
          notifyPageSelection(activeId);
          setStatus(tx('agentSuggestionsAnonymousPosted'));
          return;
        }
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
    // 下拉数据源要打网络：不 await，失败/延迟都不挡建议列表。
    bindPromptSelect().catch(() => {});
    bindPromptRetryButton();
    ensurePromptWorkspaceListener();
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
