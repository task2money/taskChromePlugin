/**
 * 「网页优化」匿名每日试用出口。
 *
 * 未登录且未配置本机智能体的用户提交页面上下文到公开试用端点；
 * 服务端按安装指纹 + 客户端 IP + 全局每日池三层记账。
 *
 * v233 起试用同样落优化贴：帖子进系统项目，服务端随响应发一次性只读令牌，
 * 插件把它存进本地（lib/page-advisor-anon-posts.js），刷新页面后照样能看、能领取。
 * 落贴失败时退回「只给即时建议」，不影响本次试用结果。
 */

'use strict';

async function loadPageTrialFingerprint() {
  const FP = typeof PluginInstallFingerprint !== 'undefined' ? PluginInstallFingerprint : null;
  if (!FP || typeof FP.ensurePluginInstallFingerprint !== 'function') return '';
  try {
    const store = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
    return String(await FP.ensurePluginInstallFingerprint(store) || '').trim();
  } catch (e) {
    console.warn('[taskChromePlugin] page trial fingerprint:', e?.message || e);
    return '';
  }
}

/** 试用失败按服务端 error_code 落到本地化文案；额度快照原样带给侧栏。 */
function pageTrialFailure(e) {
  const code = String(e?.errorCode || '').trim();
  const byCode = {
    page_trial_disabled: 'paTrialDisabled',
    page_trial_quota_exceeded: 'paTrialQuotaExceeded',
    page_trial_ip_quota_exceeded: 'paTrialIPQuotaExceeded',
    page_trial_pool_exhausted: 'paTrialPoolExhausted',
    page_trial_platform_unconfigured: 'paTrialPlatformUnconfigured',
    page_trial_generate_failed: 'paTrialGenerateFailed',
    page_trial_in_progress: 'paTrialInProgress',
    PAGE_TRIAL_FINGERPRINT_MISSING: 'paTrialFingerprintRequired',
  };
  const key = byCode[code];
  const message = key
    ? tx(key)
    : (String(e?.detail || '').trim() || e?.message || tx('paTrialUnavailable'));
  const failure = {
    ok: false,
    error: message,
    errorCode: code,
    traceId: String(e?.traceId || '').trim(),
  };
  if (e?.quota) failure.quota = e.quota;
  return failure;
}

/**
 * @param {{ cfg: object, page: { url: string, title: string, pageText: string, domOutline: object[] },
 *   locale: string, opts: object, withSpan: Function, onPhase: Function }} input
 */
async function generateViaPageTrial({ cfg, page, locale, opts, withSpan, onPhase }) {
  await onPhase(tx('paTrialGenerating'));
  const fingerprint = await loadPageTrialFingerprint();
  if (!fingerprint) {
    return {
      ok: false,
      error: tx('paTrialFingerprintRequired'),
      errorCode: 'PAGE_TRIAL_FINGERPRINT_UNAVAILABLE',
      traceId: '',
    };
  }
  const TrialAPI = typeof PageAdvisorTrialAPI !== 'undefined' ? PageAdvisorTrialAPI : null;
  if (!TrialAPI || typeof TrialAPI.suggest !== 'function') {
    return {
      ok: false,
      error: tx('paTrialUnavailable'),
      errorCode: 'PAGE_TRIAL_UNAVAILABLE',
      traceId: '',
    };
  }
  const idempotencyKey = (typeof ClickGuard !== 'undefined' && ClickGuard.newIdempotencyKey)
    ? ClickGuard.newIdempotencyKey()
    : `page-trial-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  let result;
  try {
    result = await withSpan('network', () => TrialAPI.suggest(String(cfg?.baseUrl || ''), {
      fingerprint,
      page_url: page.url,
      page_title: page.title,
      page_text: page.pageText,
      dom_outline: page.domOutline,
      locale,
    }, fingerprint, idempotencyKey));
  } catch (e) {
    return pageTrialFailure(e);
  }

  let suggestions = result?.suggestions;
  if (typeof suggestions === 'string') {
    try { suggestions = JSON.parse(suggestions); } catch (_) { suggestions = []; }
  }
  suggestions = Array.isArray(suggestions) ? suggestions.filter(Boolean) : [];
  if (!suggestions.length) {
    return {
      ok: false,
      error: tx('paTrialGenerateFailed'),
      errorCode: 'PAGE_TRIAL_EMPTY',
      traceId: String(result?.trace_id || result?._resolvedTraceId || '').trim(),
    };
  }
  if (typeof attachSuggestionAnchors === 'function') {
    suggestions = attachSuggestionAnchors(suggestions, page.domOutline);
  }
  const post = result?.post && typeof result.post === 'object' ? result.post : null;
  const anonymousPost = await rememberAnonymousTrialPost({
    post,
    pageUrl: page.url,
    pageTitle: page.title,
    suggestions,
    promptTendency: String(opts?.promptTendency || '').trim(),
  });
  return {
    ok: true,
    route: 'trial',
    trial: true,
    pageUrl: page.url,
    pageTitle: page.title,
    suggestions,
    jobId: '',
    trialId: String(result?.trial_id || '').trim(),
    quota: result?.quota || null,
    model: String(result?.model || '').trim(),
    replayed: !!result?.replayed,
    featureParamsSource: 'page_trial',
    anonymousPost,
    postError: String(result?.post_error || '').trim(),
    traceId: String(result?.trace_id || result?._resolvedTraceId || '').trim(),
  };
}

/**
 * 把服务端发的一次性访问令牌落成本地入口。失败只记日志：没有入口就等于旧行为。
 * @param {{ post: object|null, pageUrl: string, pageTitle: string, suggestions: object[], promptTendency: string }} input
 * @returns {Promise<{ postId: string, pageUrl: string, expiresAt: string }|null>}
 */
async function rememberAnonymousTrialPost(input) {
  const Anon = typeof PageAdvisorAnonPosts !== 'undefined' ? PageAdvisorAnonPosts : null;
  if (!Anon || !input?.post) return null;
  const copy = typeof agentSuggestionCopy === 'function'
    ? agentSuggestionCopy(input.suggestions, input.pageTitle)
    : {};
  try {
    const entry = await Anon.rememberEntry(null, Anon.entryFromTrialPost({ ...input, copy }));
    if (!entry) return null;
    console.info('[taskChromePlugin] anon_post_saved', {
      postId: entry.post_id,
      pageUrl: entry.page_url,
    });
    return { postId: entry.post_id, pageUrl: entry.page_url, expiresAt: entry.expires_at };
  } catch (e) {
    console.warn('[taskChromePlugin] anon_post_save_failed:', e?.message || e);
    return null;
  }
}

/**
 * 读回本地匿名入口的最新真身：成功就用服务端数据覆盖快照，404/410 说明入口已死，删掉。
 * 网络失败照旧用快照——页面刷新后仍要看得见。
 * @param {{ entry: object, baseUrl?: string, fingerprint?: string }} input
 * @returns {Promise<{ entry: object, gone: boolean }>}
 */
async function refreshAnonymousTrialPost(input) {
  const Anon = typeof PageAdvisorAnonPosts !== 'undefined' ? PageAdvisorAnonPosts : null;
  const TrialAPI = typeof PageAdvisorTrialAPI !== 'undefined' ? PageAdvisorTrialAPI : null;
  const entry = input?.entry || null;
  if (!Anon || !entry) return { entry, gone: true };
  const baseUrl = String(input?.baseUrl || '').trim();
  const fingerprint = String(input?.fingerprint || '').trim();
  if (!baseUrl || !fingerprint || typeof TrialAPI?.getPost !== 'function') {
    return { entry, gone: false };
  }
  let view;
  try {
    view = await TrialAPI.getPost(baseUrl, entry.post_id, entry.view_token, fingerprint);
  } catch (e) {
    const status = Number(e?.status || 0);
    if (status === 404 || status === 410) return { entry, gone: true };
    console.warn('[taskChromePlugin] anon_post_read_failed:', e?.message || e);
    return { entry, gone: false };
  }
  const fresh = Anon.entryFromPublicView(entry, view);
  if (!fresh) return { entry, gone: false };
  try {
    await Anon.rememberEntry(null, fresh);
  } catch (e) {
    console.warn('[taskChromePlugin] anon_post_refresh_save_failed:', e?.message || e);
  }
  return { entry: fresh, gone: false };
}

/**
 * 当前网页的匿名入口 → 侧栏条目。已关闭的入口直接从本地删掉。
 * @param {string} pageUrl
 * @returns {Promise<object[]>}
 */
async function collectAnonymousPendingForUrl(pageUrl) {
  const Anon = typeof PageAdvisorAnonPosts !== 'undefined' ? PageAdvisorAnonPosts : null;
  if (!Anon) return [];
  let entries = [];
  try {
    entries = await Anon.listEntriesForPageUrl(null, pageUrl);
  } catch (e) {
    console.warn('[taskChromePlugin] anon_posts_load_failed:', e?.message || e);
    return [];
  }
  if (!entries.length) return [];
  const cfg = await Storage.getApiConfig().catch(() => null);
  const baseUrl = String(cfg?.baseUrl || '').trim();
  const fingerprint = baseUrl ? await loadPageTrialFingerprint() : '';
  const items = [];
  for (const entry of entries) {
    const { entry: fresh, gone } = await refreshAnonymousTrialPost({ entry, baseUrl, fingerprint });
    if (gone) {
      await Anon.forgetEntry(null, entry.post_id);
      continue;
    }
    const item = Anon.itemFromEntry(fresh);
    if (item) items.push(item);
  }
  return items;
}

/** 领取用的租户：优先站点解析结果，没有再退回第一个可打开工作空间的公司。 */
function claimTenantForSite(tenant) {
  const direct = String(tenant?.tenantId || '').trim();
  if (direct) return direct;
  const Pending = typeof PageAdvisorSitePending !== 'undefined' ? PageAdvisorSitePending : null;
  const ids = Pending?.tenantIdsForSitePending
    ? Pending.tenantIdsForSitePending(tenant?.workspaces, '')
    : [];
  return String(ids[0] || '').trim();
}

/**
 * 「领取任务贴」：把匿名帖复制到登录用户的项目，成功后删掉本地入口。
 * 只由侧栏按钮触发；未登录直接拒绝，不发请求。
 * @param {{ postId?: string, viewToken?: string }} message
 */
async function handleClaimPageTrialPost(message) {
  const Anon = typeof PageAdvisorAnonPosts !== 'undefined' ? PageAdvisorAnonPosts : null;
  const postId = String(message?.postId || '').trim();
  let viewToken = String(message?.viewToken || '').trim();
  if (!postId) return { success: false, error: tx('swMissingPostOrToken') };
  // 令牌以本地入口为准：侧栏不传时按帖 id 取，避免令牌进 DOM。
  if (!viewToken && Anon) {
    const entries = await Anon.loadEntries(null);
    viewToken = String(entries.find((row) => row.post_id === postId)?.view_token || '');
  }
  if (!viewToken) return { success: false, error: tx('swMissingPostOrToken') };

  const tenant = await resolveTenantIdForSitePending();
  if (!tenant.ok) return { success: false, error: tx('swLoginBeforeClaim'), errorCode: 'not_logged_in' };
  const tenantId = claimTenantForSite(tenant);
  if (!tenantId) return { success: false, error: tx('swLoginBeforeClaim'), errorCode: 'no_tenant' };

  const idempotencyKey = (typeof ClickGuard !== 'undefined' && ClickGuard.newIdempotencyKey)
    ? ClickGuard.newIdempotencyKey()
    : `claim-${postId}-${Date.now()}`;
  try {
    const data = await PageAdvisorAPI.claimPageTrialPost(tenantId, postId, viewToken, idempotencyKey);
    if (Anon) await Anon.forgetEntry(null, postId);
    console.info('[taskChromePlugin] anon_post_claimed', {
      postId,
      projectId: String(data?.project_id || ''),
      already: !!data?.already_claimed,
    });
    return {
      success: true,
      postId: String(data?.post_id || ''),
      taskId: String(data?.task_id || ''),
      projectId: String(data?.project_id || ''),
      projectName: String(data?.project_name || ''),
      workspaceId: String(data?.workspace_id || ''),
      alreadyClaimed: !!data?.already_claimed,
      traceId: String(data?.trace_id || data?._resolvedTraceId || ''),
    };
  } catch (e) {
    const status = Number(e?.status || 0);
    // 404 错令牌 / 410 已被领取或过期：本地入口已作废，删掉免得下次又点。
    if ((status === 404 || status === 410) && Anon) await Anon.forgetEntry(null, postId);
    return {
      success: false,
      error: e?.message || tx('swClaimPostFailed'),
      errorCode: e?.errorCode || '',
      status,
      traceId: e?.traceId || '',
    };
  }
}
