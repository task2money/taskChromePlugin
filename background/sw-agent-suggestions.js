/**
 * 侧边栏「给当前网页生成建议」：生成 → 落成当前网页的优化贴（ADR-0167）。
 *
 * 落点由服务端判定：域名绑到某个项目的「全站自动优化」就挂那个项目，
 * 没绑定就挂默认项目。插件不猜落点，只把服务端回报的项目名显示给用户。
 */

'use strict';

/** 生成结果的展示文案：第一条当标题，多条时把详情编号并列。 */
function agentSuggestionCopy(suggestions, pageTitle) {
  const list = (Array.isArray(suggestions) ? suggestions : []).filter(Boolean);
  const first = list[0] || {};
  const details = list
    .map((s) => String(s?.detail || s?.summary || '').trim())
    .filter(Boolean);
  return {
    title: String(first.title || '').trim() || String(pageTitle || '').trim(),
    summary: String(first.summary || '').trim(),
    detail: details.length === 1
      ? details[0]
      : details.map((text, i) => `${i + 1}. ${text}`).join('\n'),
  };
}

/**
 * 生成结果 → 服务端 OfflineSuggestion 行。
 * 只带能再次定位的锚点字段（会话期 nid 换了页面就失效，不上行）。
 */
function agentSuggestionRows(suggestions) {
  return (Array.isArray(suggestions) ? suggestions : [])
    .map((s, i) => ({
      id: String(s?.id || `s${i + 1}`),
      title: String(s?.title || '').trim(),
      summary: String(s?.summary || '').trim(),
      detail: String(s?.detail || '').trim(),
      dom_id: String(s?.dom_id || '').trim(),
      testid: String(s?.testid || '').trim(),
      css_path: String(s?.css_path || '').trim(),
      visible_text: String(s?.visible_text || '').trim(),
      anchor_text: String(s?.anchor_text || '').trim(),
      html_snippet: String(s?.html_snippet || '').trim(),
      landmark: String(s?.landmark || '').trim(),
    }))
    .filter((row) => row.title || row.summary || row.detail);
}

// 进度出口见 sw-agent-suggestions-progress.js，诊断出口见 sw-agent-suggestions-diagnostics.js
// （行数门禁要求单个后台脚本 ≤500 行）。

/**
 * 本次生成用的提示词 id：显式给的优先，其次侧栏记住的选择；空串 = 服务端默认。
 * 只读 id，不读本地 skill 正文——正文由服务端按 id 解析。
 * @param {string|undefined} rawId
 * @returns {Promise<string>}
 */
async function resolveAgentSuggestionPromptSkillId(rawId) {
  const explicit = String(rawId ?? '').trim();
  if (explicit) return explicit;
  const Options = typeof PageAdvisorPromptOptions !== 'undefined' ? PageAdvisorPromptOptions : null;
  if (!Options || typeof Options.loadSelectedId !== 'function') return '';
  try {
    return String(await Options.loadSelectedId() || '').trim();
  } catch (e) {
    console.warn('[taskChromePlugin] load selected prompt skill:', e?.message || e);
    return '';
  }
}

/**
 * 记一次成功生成的整次耗时，供下次估算剩余时间（lib/agent-suggestions-eta.js）。
 * 只记出结果的路径：生成失败、未登录、落贴失败往往 0.x 秒早退，
 * 进入样本会把预估值拉低到不可用。记录失败不影响生成结果。
 */
async function recordAgentSuggestionDuration(elapsedMs) {
  const Eta = typeof AgentSuggestionsEta !== 'undefined' ? AgentSuggestionsEta : null;
  if (!Eta || typeof Eta.record !== 'function') return false;
  try {
    // await 落盘再返回：SW 在回包后可能被回收，不能把写入留给后台悬空 promise。
    return await Eta.record(elapsedMs);
  } catch (_e) {
    return false; // 体验数据，不影响生成
  }
}

/** 落贴租户：页面上下文给了（站点上选过工作空间）就用它，否则按列表同源的口径解析。 */
async function resolveAgentSuggestionTenant(pageTenantId) {
  const fromPage = String(pageTenantId || '').trim();
  if (fromPage) return fromPage;
  const tenant = await resolveTenantIdForSitePending();
  return tenant.ok ? String(tenant.tenantId || '') : '';
}

// 采集通道探针与「刷新当前网页并重试」见 sw-agent-suggestions-channel.js。

/**
 * @param {{ promptSkillId?: string, promptTendency?: string }} message
 * @returns {Promise<{ success: boolean, error?: string, errorCode?: string, traceId?: string,
 *   created?: boolean, postId?: string, taskId?: string, projectId?: string, projectName?: string,
 *   workspaceId?: string, matched?: boolean, matchedBy?: string, count?: number, links?: any[] }>}
 */
/** 未登录时侧栏展示今日剩余试用次数；只读公开端点，不消耗额度。 */
async function handleGetPageTrialQuota() {
  const TrialAPI = typeof PageAdvisorTrialAPI !== 'undefined' ? PageAdvisorTrialAPI : null;
  if (!TrialAPI || typeof TrialAPI.getQuota !== 'function') {
    return { success: false, errorCode: 'PAGE_TRIAL_UNAVAILABLE', error: tx('paTrialUnavailable') };
  }
  const fingerprint = await loadPageTrialFingerprint();
  if (!fingerprint) {
    return {
      success: false,
      errorCode: 'PAGE_TRIAL_FINGERPRINT_UNAVAILABLE',
      error: tx('paTrialFingerprintRequired'),
    };
  }
  try {
    const cfg = await Storage.getApiConfig();
    const quota = await TrialAPI.getQuota(String(cfg?.baseUrl || ''), fingerprint);
    return { success: true, quota };
  } catch (e) {
    return {
      success: false,
      errorCode: e?.errorCode || '',
      error: e?.detail || e?.message || '',
      traceId: e?.traceId || '',
    };
  }
}

/** 侧栏重开时读当前 tab 的进度快照；没有、已过期或存储不可用都回 null。 */
async function handleGetAgentSuggestionsProgress() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab?.id) return { success: false, reason: 'no_active_tab' };
  const Store = typeof AgentSuggestionsProgressStore !== 'undefined'
    ? AgentSuggestionsProgressStore
    : null;
  if (!Store) return { success: true, progress: null };
  return { success: true, progress: await Store.load(tab.id) };
}

/** 侧栏收起进度（本地失败）时清快照；终态清理已由进度出口负责。 */
async function handleClearAgentSuggestionsProgress() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab?.id) return { success: false, reason: 'no_active_tab' };
  const Store = typeof AgentSuggestionsProgressStore !== 'undefined'
    ? AgentSuggestionsProgressStore
    : null;
  if (!Store) return { success: true };
  await Store.clear(tab.id);
  return { success: true };
}

async function handleGenerateAgentSuggestionsForActiveTab(message) {
  // 进度只回给发起本次点击的侧栏：runId 由侧栏生成，广播时原样带回。
  const progressRunId = String(message?.progressRunId || '').trim();

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab?.id || !tab.url) {
    emitAgentSuggestionsProgress(progressRunId, { stage: 'failed', percent: 100 });
    return { success: false, error: tx('swNoActiveTab') };
  }

  const progressStartedAt = Date.now();
  const reporter = createAgentSuggestionsProgressReporter(progressRunId, tab.id, progressStartedAt);
  const onProgress = reporter.enabled ? (progress) => reporter.report(progress) : undefined;
  // 先落一条采集阶段的初始快照：侧栏此刻被关掉也还能在重开时续上。
  reporter.snapshot({ stage: 'capture', percent: 8 });

  // 下拉选的是服务端提示词 id：只回传 id，不读本地 skill 正文。
  const promptSkillId = await resolveAgentSuggestionPromptSkillId(message?.promptSkillId);
  const result = await generatePageAdvisorSuggestions(tab.id, {
    promptSkillId,
    attachAnchors: true,
    ...(onProgress ? { onProgress } : {}),
  });

  if (!result.ok) {
    reporter.report({ stage: 'failed', percent: 100 });
    const elapsedMs = Date.now() - progressStartedAt;
    const route = String(result.route || '').trim();
    const errorCode = String(result.errorCode || '').trim();
    const errorText = String(result.error || '').trim();
    const retryable = result.retryable === undefined ? undefined : !!result.retryable;
    console.warn('[taskChromePlugin] agent_suggestion_generate_failed', {
      errorCode,
      error: errorText,
      traceId: String(result.traceId || ''),
      elapsedMs,
      route,
      tabId: tab.id,
      runId: progressRunId,
    });
    // 失败诊断先落盘再回包：侧栏点「复制诊断信息」时能立刻读到这一条。
    await appendAgentSuggestionDiagnostics({
      tabId: tab.id,
      pageUrl: tab.url,
      route,
      runId: progressRunId,
      result: 'failed',
      errorCode,
      errorText,
      traceId: result.traceId || '',
      retryable,
      elapsedMs,
      attempts: result.attempts,
      model: result.model,
      promptSkillId: result.promptSkillId || promptSkillId,
      trialId: result.trialId,
      quota: result.quota,
    }, reporter);
    return {
      success: false,
      error: result.error,
      errorCode,
      ...(result.traceId ? { traceId: result.traceId } : {}),
      ...(result.links ? { links: result.links } : {}),
      ...(retryable !== undefined ? { retryable } : {}),
      ...(result.model ? { model: String(result.model) } : {}),
      ...(Number.isFinite(Number(result.attempts)) ? { attempts: Number(result.attempts) } : {}),
      elapsedMs,
    };
  }

  // 匿名每日试用：帖子落在系统项目，访问入口由本地保存（v233）；
  // 落贴失败才退回「只给即时建议」的旧形态。
  if (result.trial || result.route === 'trial') {
    const trialRows = agentSuggestionRows(result.suggestions);
    const anonymousPostId = String(result.anonymousPost?.postId || '').trim();
    const postError = String(result.postError || '').trim();
    const trialId = String(result.trialId || '').trim();
    const traceId = String(result.traceId || '').trim();
    reporter.report({ stage: 'done', percent: 100 });
    const elapsedMs = Date.now() - progressStartedAt;
    await recordAgentSuggestionDuration(elapsedMs);
    const diagResult = anonymousPostId ? 'success' : (postError ? 'post_failed' : 'no_post');
    if (postError) {
      console.warn('[taskChromePlugin] agent_suggestion_post_failed', {
        postError,
        traceId,
        trialId,
        tabId: tab.id,
        runId: progressRunId,
      });
    }
    await appendAgentSuggestionDiagnostics({
      tabId: tab.id,
      pageUrl: tab.url,
      route: 'trial',
      runId: progressRunId,
      result: diagResult,
      errorCode: postError ? `post_${postError}` : '',
      errorText: postError ? agentSuggestionPostErrorText(postError) : '',
      traceId,
      elapsedMs,
      model: result.model,
      promptSkillId: result.promptSkillId || promptSkillId,
      trialId,
      postId: anonymousPostId,
      postError,
      quota: result.quota,
    }, reporter);
    return {
      success: true,
      trial: true,
      trialId,
      suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
      quota: result.quota || null,
      count: trialRows.length,
      elapsedMs,
      ...(anonymousPostId ? { postId: anonymousPostId, anonymous: true } : {}),
      ...(postError ? { postError } : {}),
      ...(traceId ? { traceId } : {}),
    };
  }

  const tenantId = await resolveAgentSuggestionTenant(result.tenantId);
  if (!tenantId) {
    reporter.report({ stage: 'failed', percent: 100 });
    await appendAgentSuggestionDiagnostics({
      tabId: tab.id,
      pageUrl: tab.url,
      route: 'saas',
      runId: progressRunId,
      result: 'failed',
      errorCode: 'NO_TENANT',
      errorText: tx('agentSuggestionsLogin'),
      traceId: result.traceId || '',
      elapsedMs: Date.now() - progressStartedAt,
      model: result.model,
      promptSkillId: result.promptSkillId || promptSkillId,
      jobId: result.jobId,
    }, reporter);
    console.warn('[taskChromePlugin] agent_suggestion_generate_failed', {
      errorCode: 'NO_TENANT',
      tabId: tab.id,
      runId: progressRunId,
      elapsedMs: Date.now() - progressStartedAt,
      route: 'saas',
    });
    return { success: false, error: tx('agentSuggestionsLogin'), errorCode: 'NO_TENANT' };
  }

  const Pending = typeof PageAdvisorSitePending !== 'undefined' ? PageAdvisorSitePending : null;
  const rawUrl = String(result.pageUrl || tab.url || '');
  const pageUrl = Pending?.pageUrlForAgentSuggestions
    ? Pending.pageUrlForAgentSuggestions(rawUrl)
    : rawUrl;
  const copy = agentSuggestionCopy(result.suggestions, result.pageTitle);
  const rows = agentSuggestionRows(result.suggestions);
  const idempotencyKey = (typeof ClickGuard !== 'undefined' && ClickGuard.newIdempotencyKey)
    ? ClickGuard.newIdempotencyKey()
    : `agent-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  let data;
  try {
    data = await PageAdvisorAPI.createPendingSuggestion(tenantId, {
      page_url: pageUrl,
      title: copy.title,
      summary: copy.summary,
      detail: copy.detail,
      prompt_tendency: String(message?.promptTendency || '').trim(),
      prompt_skill_id: result.promptSkillId,
      // 试用路径没有生成 job，`jobId` 为空串时也照发（服务端会 trim），不伪造关联。
      ...(result.jobId !== undefined ? { suggest_job_id: result.jobId } : {}),
      suggestions: rows,
    }, idempotencyKey);
  } catch (e) {
    reporter.report({ stage: 'failed', percent: 100 });
    const errorText = e?.message || tx('agentSuggestionsGenerateFail');
    console.warn('[taskChromePlugin] agent_suggestion_generate_failed', {
      errorCode: String(e?.errorCode || ''),
      error: errorText,
      traceId: String(e?.traceId || ''),
      tabId: tab.id,
      runId: progressRunId,
      elapsedMs: Date.now() - progressStartedAt,
      route: 'saas',
    });
    await appendAgentSuggestionDiagnostics({
      tabId: tab.id,
      pageUrl: tab.url,
      route: 'saas',
      runId: progressRunId,
      result: 'failed',
      errorCode: String(e?.errorCode || ''),
      errorText,
      traceId: String(e?.traceId || ''),
      elapsedMs: Date.now() - progressStartedAt,
      model: result.model,
      promptSkillId: result.promptSkillId || promptSkillId,
      jobId: result.jobId,
    }, reporter);
    return {
      success: false,
      error: errorText,
      errorCode: e?.errorCode || '',
      ...(e?.traceId ? { traceId: e.traceId } : {}),
      elapsedMs: Date.now() - progressStartedAt,
    };
  }

  const postId = String(data?.suggestion_id || data?.suggestionId || '').trim();
  const postedElapsedMs = Date.now() - progressStartedAt;
  await recordAgentSuggestionDuration(postedElapsedMs);
  console.info('[taskChromePlugin] agent_suggestion_posted', {
    tenantId,
    postId,
    created: data?.created !== false,
    matched: !!data?.matched,
    matchedBy: String(data?.matched_by || ''),
    count: rows.length,
    elapsedMs: postedElapsedMs,
    route: 'saas',
  });
  await appendAgentSuggestionDiagnostics({
    tabId: tab.id,
    pageUrl: tab.url,
    route: 'saas',
    runId: progressRunId,
    result: postId ? 'success' : 'no_post',
    traceId: data?.trace_id || '',
    elapsedMs: postedElapsedMs,
    model: result.model,
    promptSkillId: result.promptSkillId || promptSkillId,
    jobId: result.jobId,
    postId,
  }, reporter);
  reporter.report({ stage: 'done', percent: 100 });
  return {
    success: true,
    created: data?.created !== false,
    suggestionId: postId,
    postId,
    taskId: String(data?.task_id || ''),
    projectId: String(data?.project_id || ''),
    projectName: String(data?.project_name || ''),
    workspaceId: String(data?.workspace_id || ''),
    matched: !!data?.matched,
    matchedBy: String(data?.matched_by || ''),
    count: rows.length,
    ...(data?.trace_id ? { traceId: String(data.trace_id) } : {}),
  };
}
