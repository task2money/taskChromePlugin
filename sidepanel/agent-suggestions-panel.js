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

  // 生成进度：后台按阶段广播，本地心跳补足 poll 之间的空档。
  var progressTicker = null;
  var progressHideTimer = null;
  var progressRunId = '';
  var progressStage = '';
  var progressPercent = 0;
  // 进度起点与来源：重开侧栏续显时沿用后台记下的开始时间。
  var progressStartedAt = 0;
  var progressResumed = false;
  var progressTerminalHandled = false;
  var AGENT_SUGGESTIONS_PROGRESS_TICK_MS = 500;
  var AGENT_SUGGESTIONS_PROGRESS_HIDE_MS = 900;
  // 失败态多停留几秒：用户要看清错误码/诊断入口，也避免「进度条走完就消失」。
  var AGENT_SUGGESTIONS_PROGRESS_FAILED_HIDE_MS = 6000;

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

  function setStatus(text, traceId, errorCode) {
    const status = statusEl();
    if (!status) return;
    status.textContent = text || '';
    const tid = String(traceId || '').trim();
    if (tid) status.setAttribute('data-traceId', tid);
    else status.removeAttribute('data-traceId');
    const code = String(errorCode || '').trim();
    if (code) status.setAttribute('data-error-code', code);
    else status.removeAttribute('data-error-code');
  }

  function diagEls() {
    return {
      box: document.getElementById('sp-agent-diag'),
      meta: document.getElementById('sp-agent-diag-meta'),
      copy: document.getElementById('sp-agent-copy-diag'),
    };
  }

  function formatDiagElapsed(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return tx('agentSuggestionsDiagElapsedUnknown');
    return `${(n / 1000).toFixed(1)}s`;
  }

  /**
   * 失败 / 落贴失败时显示可见错误码、耗时与 traceId，并露出「复制诊断信息」。
   * 成功后由 hideDiagnostics 移出；本地环形记录仍保留供下次复制。
   */
  function showDiagnostics(input) {
    const els = diagEls();
    if (!els.box || !els.meta) return;
    const code = String((input && input.errorCode) || '').trim();
    const traceId = String((input && input.traceId) || '').trim();
    const elapsed = formatDiagElapsed(input && input.elapsedMs);
    els.meta.textContent = traceId
      ? tx('agentSuggestionsDiagMeta', { code: code || '—', elapsed, traceId })
      : tx('agentSuggestionsDiagMetaNoTrace', { code: code || '—', elapsed });
    if (traceId) els.meta.setAttribute('data-traceId', traceId);
    else els.meta.removeAttribute('data-traceId');
    if (code) els.meta.setAttribute('data-error-code', code);
    else els.meta.removeAttribute('data-error-code');
    els.box.hidden = false;
  }

  function hideDiagnostics() {
    const els = diagEls();
    if (!els.box) return;
    els.box.hidden = true;
    if (els.meta) {
      els.meta.textContent = '';
      els.meta.removeAttribute('data-traceId');
      els.meta.removeAttribute('data-error-code');
    }
  }

  /** clipboard 优先，失败回退 textarea + execCommand（侧栏在部分环境无 clipboard 权限）。 */
  async function copyDiagText(text) {
    const value = String(text || '');
    if (!value) return false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (_e) {
      return false;
    }
  }

  async function copyDiagnostics() {
    const btn = document.getElementById('sp-agent-copy-diag');
    if (!btn || btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    btn.disabled = true;
    try {
      let text = '';
      try {
        const resp = await chrome.runtime.sendMessage({ action: 'getAgentSuggestionsDiagnostics' });
        if (resp && resp.success !== false) text = String(resp.text || '');
      } catch (_e) { text = ''; }
      // 后台组装失败时至少复制侧栏可见的元信息，别让按钮变成死路。
      if (!text) {
        const els = diagEls();
        text = els.meta ? String(els.meta.textContent || '') : '';
      }
      const ok = await copyDiagText(text);
      setStatus(tx(ok ? 'agentSuggestionsDiagCopied' : 'agentSuggestionsDiagCopyFail'));
    } finally {
      btn.dataset.busy = '0';
      btn.disabled = false;
    }
  }

  function bindCopyDiagButton() {
    const btn = document.getElementById('sp-agent-copy-diag');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => copyDiagnostics());
  }

  function progressEls() {
    return {
      box: document.getElementById('sp-agent-progress'),
      bar: document.getElementById('sp-agent-progress-bar'),
      stage: document.getElementById('sp-agent-progress-stage'),
      elapsed: document.getElementById('sp-agent-progress-elapsed'),
      pct: document.getElementById('sp-agent-progress-pct'),
    };
  }

  function progressStageLabel(stage) {
    const keys = {
      capture: 'agentSuggestionsProgressCapture',
      submit: 'agentSuggestionsProgressSubmit',
      queued: 'agentSuggestionsProgressQueued',
      generating: 'agentSuggestionsProgressGenerating',
      posting: 'agentSuggestionsProgressPosting',
      done: 'agentSuggestionsProgressDone',
      failed: 'agentSuggestionsProgressFailed',
    };
    const key = keys[String(stage || '')];
    return key ? tx(key) : '';
  }

  /** mm:ss：倒计时与已耗时共用，跨语言不需要翻译单位。 */
  function formatProgressDuration(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }

  /**
   * 已耗时常驻；未终态时补一个按 60s 基准估算的剩余时长，超时改「即将完成」。
   * 只是体验提示，不参与进度百分比，也不假装服务端给出了真实剩余时间。
   */
  function progressTimingLabel() {
    const started = Number(progressStartedAt);
    if (started <= 0) return '';
    const elapsed = Math.max(0, Date.now() - started);
    let text = tx('agentSuggestionsProgressElapsed', { time: formatProgressDuration(elapsed) });
    const P = global.AgentSuggestionsProgress;
    const terminal = P ? P.isTerminal(progressStage) : false;
    if (terminal) return text;
    const remaining = P && typeof P.remainingMs === 'function'
      ? P.remainingMs(elapsed)
      : Math.max(0, 60000 - elapsed);
    text += ' · ' + (remaining > 0
      ? tx('agentSuggestionsProgressEta', { time: formatProgressDuration(remaining) })
      : tx('agentSuggestionsProgressAlmost'));
    return text;
  }

  function renderProgress() {
    const els = progressEls();
    if (!els.box) return;
    els.box.hidden = false;
    const stageLabel = progressStageLabel(progressStage);
    if (els.bar) {
      els.bar.value = progressPercent;
      if (typeof els.bar.setAttribute === 'function') {
        els.bar.setAttribute('value', String(progressPercent));
        els.bar.setAttribute('aria-valuenow', String(progressPercent));
        els.bar.setAttribute('aria-valuetext', `${stageLabel} ${progressPercent}%`.trim());
      }
    }
    if (els.stage) els.stage.textContent = stageLabel;
    if (els.elapsed) els.elapsed.textContent = progressTimingLabel();
    if (els.pct) els.pct.textContent = progressPercent + '%';
  }

  function stopProgressTicker() {
    if (progressTicker) {
      clearInterval(progressTicker);
      progressTicker = null;
    }
  }

  function clearProgressHideTimer() {
    if (progressHideTimer) {
      clearTimeout(progressHideTimer);
      progressHideTimer = null;
    }
  }

  /** 心跳：百分比在阶段上限内缓慢补位，同时推动已耗时每秒刷新。 */
  function startProgressTicker() {
    stopProgressTicker();
    const tickMs = Number(AGENT_SUGGESTIONS_PROGRESS_TICK_MS);
    progressTicker = setInterval(() => {
      if (!progressRunId) return;
      const P = global.AgentSuggestionsProgress;
      const next = P ? P.tickPercent(progressPercent, progressStage) : progressPercent;
      if (next !== progressPercent) progressPercent = next;
      renderProgress();
    }, tickMs > 0 ? tickMs : 500);
  }

  /**
   * 点生成后立刻显示进度条：采集阶段的起点百分比先落地，
   * 之后由后台上报推进，心跳在阶段上限内缓慢补位。
   * @param {string} runId
   */
  function startProgress(runId) {
    clearProgressHideTimer();
    stopProgressTicker();
    const Progress = global.AgentSuggestionsProgress;
    progressRunId = String(runId || '');
    progressStage = 'capture';
    progressPercent = Progress ? Progress.stagePercent('capture') : 8;
    progressStartedAt = Date.now();
    progressResumed = false;
    progressTerminalHandled = false;
    renderProgress();
    startProgressTicker();
  }

  /** 续显的是后台还在跑的任务：生成按钮保持锁住，避免又发起一次重复生成。 */
  function holdGenerateButtonForResume() {
    const btn = generateButton();
    if (!btn) return;
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  }

  /** 只释放续显期间锁住的按钮；本地生成由 generate() 自己的 finally 负责恢复。 */
  function releaseGenerateButtonAfterResume() {
    const btn = generateButton();
    if (!btn || btn.dataset.busy !== '1') return;
    btn.dataset.busy = '0';
    btn.disabled = false;
    btn.setAttribute('aria-busy', 'false');
  }

  /**
   * 重开侧栏续显后台还在跑的生成：runId 取快照，之后的广播才能接上；
   * 已终态（极少见，正常终态会清快照）按终态收尾。
   */
  function resumeProgress(snapshot) {
    if (!snapshot) return;
    const id = String(snapshot.runId || '').trim();
    if (!id) return;
    const P = global.AgentSuggestionsProgress;
    const stage = P ? P.normalizeStage(snapshot.stage) : String(snapshot.stage || 'capture');
    clearProgressHideTimer();
    progressRunId = id;
    progressStage = stage === 'idle' ? 'capture' : stage;
    progressPercent = P ? P.percentForEvent({ stage: progressStage, percent: snapshot.percent }) : 0;
    const started = Number(snapshot.startedAt);
    progressStartedAt = started > 0 && started <= Date.now() ? started : Date.now();
    progressResumed = true;
    progressTerminalHandled = false;
    holdGenerateButtonForResume();
    renderProgress();
    if (P && P.isTerminal(progressStage)) {
      onResumedTerminal(progressStage);
      return;
    }
    startProgressTicker();
  }

  /**
   * 侧栏关着时生成收尾了：刷新列表把新贴带出来，并让页面显示选中的那条。
   * 广播可能比侧栏重开晚到，这里也会走到。
   */
  function onResumedTerminal(stage) {
    if (progressTerminalHandled) return;
    progressTerminalHandled = true;
    if (stage === 'done') {
      hideDiagnostics();
      scheduleProgressHide();
      refresh().then(() => {
        if (activeId) notifyPageSelection(activeId);
        setStatus(tx('agentSuggestionsProgressDone'));
      }).catch(() => {});
      return;
    }
    // 侧栏关着时失败：仍给出诊断入口，用户可直接复制后台记下的那一条。
    const elapsedMs = progressStartedAt > 0 ? Date.now() - progressStartedAt : 0;
    setStatus(tx('agentSuggestionsGenerateFail'));
    showDiagnostics({ errorCode: '', traceId: '', elapsedMs });
    scheduleProgressHide(AGENT_SUGGESTIONS_PROGRESS_FAILED_HIDE_MS);
  }

  /** 只认本次点击的 runId：上一次生成的迟到事件不能画到新进度条上。 */
  function applyProgressEvent(runId, event) {
    const id = String(runId || '');
    if (!id || id !== progressRunId || !event) return;
    const P = global.AgentSuggestionsProgress;
    const stage = P ? P.normalizeStage(event.stage) : String(event.stage || '');
    if (stage && stage !== 'idle') progressStage = stage;
    const pct = P ? P.percentForEvent(event) : Number(event.percent);
    if (Number.isFinite(pct)) {
      progressPercent = Math.max(progressPercent, Math.min(100, Math.round(pct)));
    }
    if (P && P.isTerminal(progressStage)) {
      stopProgressTicker();
      if (progressResumed) onResumedTerminal(progressStage);
    }
    renderProgress();

  }

  function finishProgress(stage) {
    applyProgressEvent(progressRunId, { stage: stage || 'done', percent: 100 });
    stopProgressTicker();
  }

  /** 侧栏本地收起（成功停留后 / 失败）时清掉快照，避免下次重开续到已结束的任务。 */
  function clearProgressSnapshot() {
    try {
      if (!global.chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') return;
      const pending = chrome.runtime.sendMessage({ action: 'clearAgentSuggestionsProgress' });
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch (_e) { /* 清快照失败不影响收起 */ }
  }

  function hideProgress() {
    const hadRunId = !!progressRunId;
    const wasResumed = progressResumed;
    clearProgressHideTimer();
    stopProgressTicker();
    progressRunId = '';
    progressStage = '';
    progressPercent = 0;
    progressStartedAt = 0;
    progressResumed = false;
    progressTerminalHandled = false;
    if (wasResumed) releaseGenerateButtonAfterResume();
    const els = progressEls();
    if (els.box) els.box.hidden = true;
    if (els.bar) {
      els.bar.value = 0;
      if (typeof els.bar.setAttribute === 'function') {
        els.bar.setAttribute('value', '0');
        els.bar.setAttribute('aria-valuenow', '0');
        els.bar.removeAttribute('aria-valuetext');
      }
    }
    if (els.elapsed) els.elapsed.textContent = '';
    if (hadRunId) clearProgressSnapshot();
  }

  /** @param {number} [delayMs] 不传按成功停留 900ms；失败态传 6000ms。 */
  function scheduleProgressHide(delayMs) {
    clearProgressHideTimer();
    const fallback = Number(AGENT_SUGGESTIONS_PROGRESS_HIDE_MS);
    const wanted = Number(delayMs);
    const ms = Number.isFinite(wanted) && wanted >= 0
      ? wanted
      : (fallback > 0 ? fallback : 0);
    progressHideTimer = setTimeout(() => {
      progressHideTimer = null;
      hideProgress();
    }, ms);
  }

  function onAgentSuggestionsProgressMessage(message) {
    if (!message || message.action !== 'agentSuggestionsProgress') return;
    applyProgressEvent(message.runId, message.progress);
  }

  /**
   * 侧栏重开时问后台要当前 tab 的快照。生成中（按钮 busy）或已有本地进度时不查，
   * 免得旧快照覆盖用户刚点下的这一次。
   */
  async function resumeProgressIfAny() {
    const btn = generateButton();
    if ((btn && btn.dataset.busy === '1') || progressRunId) return;
    try {
      if (!global.chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') return;
      const resp = await chrome.runtime.sendMessage({ action: 'getAgentSuggestionsProgress' });
      if (!resp || resp.success === false || !resp.progress) return;
      const current = generateButton();
      if ((current && current.dataset.busy === '1') || progressRunId) return;
      resumeProgress(resp.progress);
    } catch (_e) { /* 续显失败不影响列表与生成 */ }
  }

  function removeProgressResources() {
    stopProgressTicker();
    clearProgressHideTimer();
    try {
      if (global.chrome && chrome.runtime && chrome.runtime.onMessage
        && typeof chrome.runtime.onMessage.removeListener === 'function') {
        chrome.runtime.onMessage.removeListener(onAgentSuggestionsProgressMessage);
      }
    } catch (_e) { /* 卸载路径不抛 */ }
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
    // `{}` / `{skills:null}` 这类形状不对的响应不能当「服务端没有提示词」：
    // 那会把失败画成空目录且不给重试，用户无从分辨。只有带数组 skills 的响应才算成功。
    const usable = !!resp && resp.ok !== false && resp.success !== false && Array.isArray(resp.skills);
    if (!usable) {
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

    // 本次点击的 runId：后台进度广播原样带回，侧栏只画自己这一次。
    const runId = `agent-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    setReloadRetryVisible(false);
    hideDiagnostics();
    setStatus(tx('agentSuggestionsGenerating') + ' ' + tx('agentSuggestionsGeneratingHint'));
    startProgress(runId);
    let succeeded = false;
    try {
      // Anti-Replay-OK: 生成由后台带 Idempotency-Key 发一次；这里只挡住重复点击
      const resp = await chrome.runtime.sendMessage({
        action: 'generateAgentSuggestionsForActiveTab',
        promptSkillId: skill ? String(skill.id) : '',
        promptTendency: skill ? String(skill.tendency || '') : '',
        progressRunId: runId,
      });
      if (!resp || resp.success === false) {
        const errorCode = String((resp && resp.errorCode) || '').trim();
        const traceId = String((resp && resp.traceId) || '').trim();
        const elapsedMs = progressStartedAt > 0 ? Date.now() - progressStartedAt : 0;
        const message = (resp && resp.error) || tx('agentSuggestionsGenerateFail');
        // 状态行纯文本也带 traceId（约束 24）；诊断块再完整展示错误码 / 耗时。
        const withTrace = typeof formatErrorWithTraceId === 'function'
          ? formatErrorWithTraceId(message, traceId)
          : message;
        setStatus(withTrace, traceId, errorCode);
        // 只有「刷新页面能修好」的那类失败才给一键入口。
        setReloadRetryVisible(resp && resp.errorCode === 'PAGE_CONTEXT_UNREACHABLE');
        showDiagnostics({ errorCode, traceId, elapsedMs });
        return;
      }
      succeeded = true;
      if (resp.trial) {
        // 落成匿名优化贴时与登录用户同形：列表里多一条帖子，选中即在页面显示；
        // 只有落贴失败（无 postId）才退回「只给即时建议」的旧形态。
        const anonymousPostId = String(resp.postId || '').trim();
        const elapsedMs = progressStartedAt > 0 ? Date.now() - progressStartedAt : 0;
        if (anonymousPostId) {
          trialShown = false;
          await refresh();
          activeId = anonymousPostId;
          render();
          notifyPageSelection(activeId);
          hideDiagnostics();
          setStatus(tx('agentSuggestionsAnonymousPosted'), resp.traceId);
          return;
        }
        renderTrialSuggestions(resp);
        const postError = String(resp.postError || '').trim();
        if (postError) {
          // 建议已经生成，只是落贴失败：显式告诉用户原因，并给出诊断入口。
          const traceId = String(resp.traceId || '').trim();
          const reason = postError === 'unavailable'
            ? tx('agentSuggestionsPostUnavailable')
            : (postError === 'closed' ? tx('agentSuggestionsPostClosed') : postError);
          const errorCode = `post_${postError}`;
          setStatus(tx('agentSuggestionsTrialPostFailed', { reason }), traceId, errorCode);
          showDiagnostics({ errorCode, traceId, elapsedMs });
          return;
        }
        hideDiagnostics();
        setStatus(resp.quota ? trialQuotaStatus(resp.quota) : tx('agentSuggestionsTrialHint'), resp.traceId);
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
      hideDiagnostics();
      setStatus(tx(resp.created === false ? 'agentSuggestionsPostedExisting' : 'agentSuggestionsGeneratedInto',
        project ? { project } : ''), resp.traceId);
    } catch (e) {
      const elapsedMs = progressStartedAt > 0 ? Date.now() - progressStartedAt : 0;
      setStatus(e?.message || tx('agentSuggestionsGenerateFail'), '', 'CLIENT_EXCEPTION');
      showDiagnostics({ errorCode: 'CLIENT_EXCEPTION', traceId: '', elapsedMs });
    } finally {
      btn.dataset.busy = '0';
      btn.disabled = false;
      btn.setAttribute('aria-busy', 'false');
      if (succeeded) {
        finishProgress('done');
        scheduleProgressHide();
      } else {
        // 失败态保留约 6 秒：用户能看清错误与诊断入口，不再「进度条走完就消失」。
        finishProgress('failed');
        scheduleProgressHide(AGENT_SUGGESTIONS_PROGRESS_FAILED_HIDE_MS);
      }
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
    bindCopyDiagButton();
    // 探测不挡列表：等它回来再决定要不要露出刷新入口。
    probeCaptureChannel();
    // 侧栏可能是关掉后重开的：问一次后台有没有还在跑的生成，有就续显进度。
    resumeProgressIfAny();
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

  // 后台生成进度：只在本次点击的 runId 上落地；其他消息不响应、不拦截。
  if (global.chrome && chrome.runtime && chrome.runtime.onMessage
    && typeof chrome.runtime.onMessage.addListener === 'function') {
    chrome.runtime.onMessage.addListener(onAgentSuggestionsProgressMessage);
  }
  (function bindProgressUnloadCleanup() {
    const target = typeof global.addEventListener === 'function'
      ? global
      : (global.window && typeof global.window.addEventListener === 'function' ? global.window : null);
    if (target) target.addEventListener('unload', removeProgressResources);
  })();

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
