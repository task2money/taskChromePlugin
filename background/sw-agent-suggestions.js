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

/** 下拉里选中的那条提示词；选「默认提示词」时返回 null。 */
async function loadAgentSuggestionSkill(skillId) {
  const id = String(skillId || '').trim();
  if (!id || typeof PageAdvisorPromptSkills === 'undefined') return null;
  try {
    const store = await PageAdvisorPromptSkills.loadFromStorage();
    const skills = Array.isArray(store?.skills) ? store.skills : [];
    return skills.find((s) => String(s?.id || '') === id) || null;
  } catch (e) {
    console.warn('[taskChromePlugin] load prompt skill:', e?.message || e);
    return null;
  }
}

/** 默认提示词：与 Alt+Z 同源（本机已激活技能，缺则补拉系统目录）。 */
async function loadAgentSuggestionDefaultSkill() {
  const cfg = await Storage.getApiConfig();
  const expired = cfg.token ? await Storage.isTokenExpired() : false;
  return loadDirectLlmSkill(!!(cfg.token && !expired));
}

/** 落贴租户：页面上下文给了（站点上选过工作空间）就用它，否则按列表同源的口径解析。 */
async function resolveAgentSuggestionTenant(pageTenantId) {
  const fromPage = String(pageTenantId || '').trim();
  if (fromPage) return fromPage;
  const tenant = await resolveTenantIdForSitePending();
  return tenant.ok ? String(tenant.tenantId || '') : '';
}

/**
 * 「刷新当前网页并重试」的等待预算：等 tab 回到 complete 后再探采集通道是否恢复。
 * 刷新会丢页面未保存状态，故这条路径只由用户点击触发，绝不自动刷新。
 */
var AGENT_SUGGESTIONS_CONTENT_READY_MS = 15000;
var AGENT_SUGGESTIONS_PROBE_POLL_MS = 300;

/**
 * 采集通道存活探针：只用轻量 ping，绝不用 `getPageAdvisorContext`——
 * 后者会消费已框选/拾取的元素并清空选区，当探针用会吃掉用户的选择。
 * 主 frame 优先，打不通再整 tab 广播（与采集同口径）。
 *
 * @returns {Promise<{ready: boolean, instanceId: string}|null>} `null` = 监听器不在。
 */
async function pingAgentSuggestionsChannel(tabId) {
  const ping = { action: 'pingPageAdvisorContext' };
  const read = (resp) => (resp && resp.success
    ? { ready: !!resp.ready, instanceId: String(resp.instanceId || '') }
    : null);
  try {
    const hit = read(await chrome.tabs.sendMessage(tabId, ping, { frameId: 0 }));
    if (hit) return hit;
  } catch (_) { /* 主 frame 没有监听器，退整 tab 广播 */ }
  try {
    return read(await chrome.tabs.sendMessage(tabId, ping));
  } catch (_) {
    // 监听器不在（扩展重载后的旧页面）→ 连接直接失败，正是要判死的情形。
    return null;
  }
}

/** 当前页面采集通道状态：`ready` / `restricted`（刷新无用）/ `unreachable`（刷新可修）。 */
async function agentSuggestionsChannelState(tabId, url) {
  if (typeof isPageAdvisorBlockedUrl === 'function' && isPageAdvisorBlockedUrl(url)) return 'restricted';
  const ping = await pingAgentSuggestionsChannel(tabId);
  return (ping && ping.ready) ? 'ready' : 'unreachable';
}

/** 侧栏打开 / 切 tab 时探一次：只回答「要不要把刷新入口摆出来」。 */
async function handleProbeAgentSuggestionsChannel() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab?.id) return { success: false, reason: 'no_active_tab' };
  const state = await agentSuggestionsChannelState(tab.id, tab.url);
  return {
    success: true,
    state,
    // 与生成失败时同码：侧栏据此决定是否露出「刷新并重试」。
    errorCode: state === 'unreachable' ? 'PAGE_CONTEXT_UNREACHABLE' : '',
    retryable: state === 'unreachable',
  };
}

/** 等 tab 加载完并重新探到采集通道；刷新后 content script 要重新注入。 */
async function waitForAgentSuggestionsChannel(tabId, staleInstanceId) {
  const budget = Number(AGENT_SUGGESTIONS_CONTENT_READY_MS) > 0
    ? Number(AGENT_SUGGESTIONS_CONTENT_READY_MS)
    : 15000;
  const pollMs = Number(AGENT_SUGGESTIONS_PROBE_POLL_MS) > 0 ? Number(AGENT_SUGGESTIONS_PROBE_POLL_MS) : 300;
  const deadline = Date.now() + budget;
  const stale = String(staleInstanceId || '');
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && tab.status === 'complete') {
      const ping = await pingAgentSuggestionsChannel(tabId);
      // instanceId 与刷新前相同 = 新文档还没提交，探到的是即将被替换掉的旧实例，
      // 此刻「通了」是假象：收工太早会让用户点完刷新又失败一次。
      if (ping && ping.ready && ping.instanceId !== stale) return true;
      // 页面类型本身不支持：刷新也不会变好，别再空等。
      if (typeof isPageAdvisorBlockedUrl === 'function' && isPageAdvisorBlockedUrl(tab.url)) return false;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

/**
 * 「刷新当前网页并重试」：开发者模式重载扩展后，已打开页面的 content script 会随旧实例
 * 失效（页面浮窗 DOM 还在，看着一切正常），刷新页面即可恢复。
 *
 * 刷新会丢页面未保存状态，所以只由用户点击触发，这里不做任何自动刷新。通道恢复后
 * 由侧栏重跑一次生成——生成本身是「生成 → 落贴」的同一段代码，不在这里复制一份。
 */
async function handleReloadActiveTabAndRetry() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab?.id) return { success: false, error: tx('swNoActiveTab') };
  if (typeof isPageAdvisorBlockedUrl === 'function' && isPageAdvisorBlockedUrl(tab.url)) {
    // 刷新不会让此类页面变得可采集：别让用户白等一次刷新（页面状态还会丢）。
    return { success: false, error: tx('paContextRestrictedPage'), errorCode: 'PAGE_CONTEXT_RESTRICTED_PAGE' };
  }
  // 先记下刷新前那个实例：刷新后只有换过实例才算真恢复。
  const before = await pingAgentSuggestionsChannel(tab.id);
  await chrome.tabs.reload(tab.id);
  if (!await waitForAgentSuggestionsChannel(tab.id, before ? before.instanceId : '')) {
    return { success: false, error: tx('paContextUnreachable'), errorCode: 'PAGE_CONTEXT_UNREACHABLE' };
  }
  console.info('[taskChromePlugin] page_context_recovered', { tabId: tab.id });
  return { success: true };
}

/** 当前生效的路由（`builtin` / `direct` / `saas` / `system`）；取不到就交回生成核心。 */
async function resolveAgentSuggestionRoute() {
  if (typeof loadPageAdvisorDirectReady !== 'function') return '';
  try {
    const ready = await loadPageAdvisorDirectReady();
    return String((ready && ready.route) || '');
  } catch (e) {
    console.warn('[taskChromePlugin] resolve page-advisor route:', e?.message || e);
    return '';
  }
}

/**
 * 本机内置模型（Chrome 自带 LanguageModel）那条出口。
 *
 * 生成核心 `generatePageAdvisorSuggestions` 对 `route === 'builtin'` 直接拒绝：内置模型要先过
 * 启用态检查与下载/启用引导，那套流程只活在 `PageAdvisorBuiltinPrompt.runAltZ` 里。这里把同一组
 * 注入点接过来，让侧边栏「生成建议」与页面 Alt+Z 走同一条生成路径，落贴仍复用下面的公共代码。
 *
 * @returns {Promise<object|null>} `null` 表示「不是 builtin」，交回生成核心处理。
 */
async function runBuiltinAgentSuggestions(tabId, skill) {
  const Prompt = typeof PageAdvisorBuiltinPrompt !== 'undefined' ? PageAdvisorBuiltinPrompt : null;
  if (!Prompt || typeof Prompt.runAltZ !== 'function') return null;
  if (await resolveAgentSuggestionRoute() !== 'builtin') return null;
  // 这里不断言 LanguageModel 存在：缺席时 runAltZ 会按 `builtin_unavailable` 给出「去启用内置模型」
  // 的具体引导，比生成核心那句「去页面按 Alt+Z」更准确（那条路同样没有模型可用）。

  let payload = null;
  await Prompt.runAltZ(tabId, {
    languageModel: globalThis.LanguageModel,
    askContext: (id) => askContentPageAdvisorContext(id),
    notify: notifyContentPageAdvisor,
    loadSkill: () => Promise.resolve(skill || loadAgentSuggestionDefaultSkill()),
    locale: resolvePageAdvisorLocale(),
    tx,
    onResult: (p) => { payload = p; },
  });
  if (!payload) {
    return { ok: false, error: tx('agentSuggestionsGenerateFail'), errorCode: '', traceId: '' };
  }
  if (!payload.ok) {
    // runAltZ 已经按 builtin 的可用性给了具体文案（下载中/待启用/不可用），原样透传给侧边栏。
    return {
      ok: false,
      error: payload.error || tx('agentSuggestionsGenerateFail'),
      errorCode: payload.errorCode || '',
      traceId: '',
    };
  }
  return {
    ok: true,
    route: 'builtin',
    pageUrl: String(payload.pageUrl || ''),
    pageTitle: '',
    suggestions: Array.isArray(payload.suggestions) ? payload.suggestions : [],
    jobId: '',
    featureParamsSource: 'plugin_builtin',
    traceId: '',
  };
}

/**
 * @param {{ skillId?: string, promptTendency?: string }} message
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

async function handleGenerateAgentSuggestionsForActiveTab(message) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab?.id || !tab.url) return { success: false, error: tx('swNoActiveTab') };

  const skill = await loadAgentSuggestionSkill(message?.skillId);
  const builtin = await runBuiltinAgentSuggestions(tab.id, skill);
  const result = builtin || await generatePageAdvisorSuggestions(tab.id, skill
    ? { skill, attachAnchors: true }
    : { skillLoader: () => loadAgentSuggestionDefaultSkill(), attachAnchors: true });

  if (!result.ok) {
    return {
      success: false,
      error: result.error,
      errorCode: result.errorCode || '',
      ...(result.traceId ? { traceId: result.traceId } : {}),
      ...(result.links ? { links: result.links } : {}),
    };
  }

  // 匿名每日试用：帖子落在系统项目，访问入口由本地保存（v233）；
  // 落贴失败才退回「只给即时建议」的旧形态。
  if (result.trial || result.route === 'trial') {
    const trialRows = agentSuggestionRows(result.suggestions);
    const anonymousPostId = String(result.anonymousPost?.postId || '').trim();
    return {
      success: true,
      trial: true,
      trialId: String(result.trialId || '').trim(),
      suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
      quota: result.quota || null,
      count: trialRows.length,
      ...(anonymousPostId ? { postId: anonymousPostId, anonymous: true } : {}),
      ...(result.postError ? { postError: String(result.postError) } : {}),
      ...(result.traceId ? { traceId: result.traceId } : {}),
    };
  }

  const tenantId = await resolveAgentSuggestionTenant(result.tenantId);
  if (!tenantId) return { success: false, error: tx('agentSuggestionsLogin') };

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
      prompt_tendency: String(skill?.tendency || message?.promptTendency || '').trim(),
      suggestions: rows,
    }, idempotencyKey);
  } catch (e) {
    return {
      success: false,
      error: e?.message || tx('agentSuggestionsGenerateFail'),
      errorCode: e?.errorCode || '',
      ...(e?.traceId ? { traceId: e.traceId } : {}),
    };
  }

  const postId = String(data?.suggestion_id || data?.suggestionId || '').trim();
  console.info('[taskChromePlugin] agent_suggestion_posted', {
    tenantId,
    postId,
    created: data?.created !== false,
    matched: !!data?.matched,
    matchedBy: String(data?.matched_by || ''),
    count: rows.length,
  });
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
