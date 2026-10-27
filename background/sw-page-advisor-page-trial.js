/**
 * 「网页优化」匿名每日试用出口。
 *
 * 未登录且未配置本机智能体的用户提交页面上下文到公开试用端点；
 * 服务端按安装指纹 + 客户端 IP + 全局每日池三层记账，插件只展示结果，
 * 不落优化贴（落贴需要租户，登录后才有）。
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
    traceId: String(result?.trace_id || result?._resolvedTraceId || '').trim(),
  };
}
