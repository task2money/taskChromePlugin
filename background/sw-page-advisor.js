/** Alt+Z page-optimization-suggest: auth → page context → suggest job → poll → content UI. */

'use strict';

/**
 * 可选截图上传钩子（失败不阻断）。默认跳过复杂路径；需要时由调用方注入。
 * @param {number} _tabId
 * @returns {Promise<string>} screenshot_url or ''
 */
async function capturePageAdvisorScreenshotHook(_tabId) {
  // Screenshot-Hook-OK: optional; design allows skip when complex — leave hook for later.
  return '';
}

/**
 * 采集重试预算（毫秒）：页面还在加载时值得等 content script 注入完；
 * 已加载完只剩脚本链条收尾的一点点时间，短等即判死。
 * 加载预算留在 Alt+Z 内置路径给 askContext 的 12s 包裹之内，别让它先报超时。
 * 变量可被运行环境覆盖（单测按需调小）。
 */
var PAGE_ADVISOR_CONTEXT_WAIT_LOADING_MS = 10000;
var PAGE_ADVISOR_CONTEXT_WAIT_READY_MS = 1000;
var PAGE_ADVISOR_CONTEXT_POLL_MS = 500;

/** content script 永远注入不进去的页面：刷新也没用，得换页面。 */
var PAGE_ADVISOR_BLOCKED_URL_PREFIXES = [
  'chrome://', 'chrome-untrusted://', 'devtools://', 'edge://',
  'about:', 'view-source:', 'chrome-extension://', 'file://',
];
var PAGE_ADVISOR_BLOCKED_URL_HOSTS = ['chrome.google.com/webstore', 'chromewebstore.google.com'];

function isPageAdvisorBlockedUrl(url) {
  const u = String(url || '').trim().toLowerCase();
  if (!u) return false;
  if (PAGE_ADVISOR_BLOCKED_URL_PREFIXES.some((prefix) => u.startsWith(prefix))) return true;
  return PAGE_ADVISOR_BLOCKED_URL_HOSTS.some(
    (host) => u.startsWith(`http://${host}`) || u.startsWith(`https://${host}`),
  );
}

/** 采集失败走响应对象（不抛原始连接错误），上层按 errorCode 决定文案。 */
function pageContextFailure(errorCode, error) {
  return { success: false, errorCode, error };
}

/** 取一次上下文：顶层 frame 优先，打不通再整 tab 广播。 */
async function sendContentContextOnce(tabId, msg) {
  const wrap = (p) => (typeof withTimeout === 'function' ? withTimeout(p, 12000, 'getPageAdvisorContext') : p);
  try {
    return { ok: true, resp: await wrap(chrome.tabs.sendMessage(tabId, msg, { frameId: 0 })) };
  } catch (frame0Err) {
    console.warn('[taskChromePlugin] getPageAdvisorContext frame0 失败，回退整 tab 广播:', frame0Err?.message || frame0Err);
    try {
      return { ok: true, resp: await wrap(chrome.tabs.sendMessage(tabId, msg)) };
    } catch (broadcastErr) {
      return { ok: false, err: broadcastErr };
    }
  }
}

/** 采集到上下文 = 监听器回了 success + data。 */
function isContentContextResponse(attempt) {
  return !!(attempt && attempt.ok && attempt.resp && attempt.resp.success && attempt.resp.data);
}

/** 读 tab 元信息（URL / 加载状态）；拿不到就按未知处理，不影响兜底文案。 */
async function readPageAdvisorTab(tabId) {
  if (!chrome.tabs || typeof chrome.tabs.get !== 'function') return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch (_) {
    return null;
  }
}

/** 诊断日志只留 origin，不带 query/hash（可能含用户数据）。 */
function pageAdvisorUrlForLog(url) {
  return String(url || '').replace(/[?#].*$/, '').slice(0, 120);
}

/**
 * 向 tab 顶层 frame 取页面上下文；失败则整 tab 广播。
 *
 * 采不通时先按页面加载状态等一小段再试（用户点早了），仍不通则按原因返回失败对象：
 * `PAGE_CONTEXT_UNREACHABLE`（页面里没有活着的 content script，刷新即可）或
 * `PAGE_CONTEXT_RESTRICTED_PAGE`（页面类型本身不支持）。绝不把原始连接错误抛给用户。
 * @param {number} tabId
 */
async function askContentPageAdvisorContext(tabId) {
  const msg = { action: 'getPageAdvisorContext' };
  let attempt = await sendContentContextOnce(tabId, msg);
  if (isContentContextResponse(attempt)) return attempt.resp;

  const tab = await readPageAdvisorTab(tabId);
  const url = String((tab && tab.url) || '');
  if (isPageAdvisorBlockedUrl(url)) {
    return pageContextFailure('PAGE_CONTEXT_RESTRICTED_PAGE', tx('paContextRestrictedPage'));
  }

  const status = String((tab && tab.status) || '');
  const loading = status === 'loading' || status === 'unloaded';
  const budget = Number(loading ? PAGE_ADVISOR_CONTEXT_WAIT_LOADING_MS : PAGE_ADVISOR_CONTEXT_WAIT_READY_MS) || 0;
  const deadline = Date.now() + budget;
  while (Date.now() < deadline) {
    const waitMs = Math.max(0, Math.min(Number(PAGE_ADVISOR_CONTEXT_POLL_MS) || 0, deadline - Date.now()));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    attempt = await sendContentContextOnce(tabId, msg);
    if (isContentContextResponse(attempt)) return attempt.resp;
  }

  // 监听器活着、只是自报未就绪：它自己的文案更具体，别用兜底盖掉。
  if (attempt && attempt.ok && attempt.resp) return attempt.resp;

  // 一行可 grep 的现场 + 结构化载荷（URL 只留 origin，不带 query/hash）。
  console.warn(
    `[taskChromePlugin] page_context_unreachable tabId=${tabId} status=${status || 'unknown'} page=${pageAdvisorUrlForLog(url)}`,
    { err: (attempt && attempt.err && attempt.err.message) || '' },
  );
  return pageContextFailure('PAGE_CONTEXT_UNREACHABLE', tx('paContextUnreachable'));
}

async function notifyContentPageAdvisor(tabId, payload) {
  const msg = { action: 'pageAdvisorResult', ...payload };
  try {
    await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch (_) {
    try {
      await chrome.tabs.sendMessage(tabId, msg);
    } catch (e) {
      console.warn('[taskChromePlugin] pageAdvisorResult 投递失败:', e?.message || e);
    }
  }
}

async function loadPageAdvisorDirectReady() {
  let llmCfg = { apiKey: '', baseUrl: '', model: '' };
  if (typeof PageAdvisorLlmConfig !== 'undefined' && PageAdvisorLlmConfig.loadFromStorage) {
    try {
      llmCfg = await PageAdvisorLlmConfig.loadFromStorage();
    } catch (e) {
      console.warn('[taskChromePlugin] load page-advisor LLM config:', e?.message || e);
    }
  }
  const hasCfg = typeof PageAdvisorLlmConfig !== 'undefined';
  const route = (hasCfg && typeof PageAdvisorLlmConfig.resolveRoute === 'function')
    ? PageAdvisorLlmConfig.resolveRoute(llmCfg) : 'saas';
  const keyReady = hasCfg && PageAdvisorLlmConfig.isDirectLlmReady(llmCfg)
    && typeof PageAdvisorLLM !== 'undefined' && typeof PageAdvisorLLM.suggest === 'function';
  const directReady = route === 'direct' && keyReady;
  return { llmCfg, route, directReady };
}

function resolvePageAdvisorLocale() {
  try {
    if (typeof AidevpushI18n !== 'undefined' && typeof AidevpushI18n.getLocale === 'function') {
      const loc = String(AidevpushI18n.getLocale() || '').trim();
      if (loc) return loc;
    }
  } catch (_) { /* ignore */ }
  return 'zh-CN';
}

async function loadDirectLlmSkill(sessionOk) {
  if (typeof PageAdvisorPromptSkills === 'undefined'
    || typeof PageAdvisorPromptSkills.loadFromStorage !== 'function') {
    return null;
  }
  const store = await PageAdvisorPromptSkills.loadFromStorage();
  const existing = PageAdvisorPromptSkills.getActive(store);
  if (existing) return existing;
  if (!sessionOk) return null;
  if (typeof PageAdvisorAPI === 'undefined'
    || typeof PageAdvisorAPI.getSystemPromptSkills !== 'function') {
    return null;
  }
  const catalog = await PageAdvisorAPI.getSystemPromptSkills();
  const live = (catalog && catalog.skills) || [];
  const lastWs = (typeof Storage !== 'undefined' && typeof Storage.getLastWorkspace === 'function')
    ? String(await Storage.getLastWorkspace() || '').trim()
    : '';
  const rec = PageAdvisorPromptSkills.applySystemCatalogDefault(
    store,
    live.length ? catalog : { skills: [] },
    lastWs || PageAdvisorPromptSkills.SYNC_LOCAL,
    { overlayExisting: live.length > 0 },
  );
  if (rec.action !== 'applied') return null;
  await PageAdvisorPromptSkills.saveToStorage(rec.store);
  const active = PageAdvisorPromptSkills.getActive(rec.store);
  if (active) {
    console.info('[taskChromePlugin] direct LLM applying system catalog skill', active.title);
  }
  return active;
}

/**
 * Alt+Z 主流程（await 轮询以保持 MV3 SW 存活，上限 PAGE_ADVISOR_POLL_MAX_MS）。
 * 生成本身走 `generatePageAdvisorSuggestions`（与侧边栏「生成建议」共用），
 * 这里只把结果画到当前页面。
 * @param {number} tabId
 */
async function runPageOptimizationSuggest(tabId) {
  if (typeof setPageAdvisorWaterfallTab === 'function') setPageAdvisorWaterfallTab(tabId);
  await Storage.migrateStaleTokenExpiryOnce();
  const cfg = await Storage.getApiConfig();
  const expired = cfg.token ? await Storage.isTokenExpired() : false;
  const sessionOk = !!(cfg.token && !expired);
  const { route } = await loadPageAdvisorDirectReady();
  const command = consumePageAdvisorSuggestCommand();
  const timingRun = beginPageAdvisorTimingRun(route, command);
  const withSpan = bindPageAdvisorWithSpan(timingRun);

  if (route === 'builtin' && globalThis.LanguageModel && PageAdvisorBuiltinPrompt?.runAltZ) {
    await PageAdvisorBuiltinPrompt.runAltZ(tabId, {
      languageModel: globalThis.LanguageModel,
      askContext: (id) => withSpan('capture', () => askContentPageAdvisorContext(id)),
      notify: wrapBuiltinAdvisorNotify(notifyContentPageAdvisor, withSpan, timingRun),
      loadSkill: () => withSpan('prompt', () => loadDirectLlmSkill(sessionOk)),
      locale: resolvePageAdvisorLocale(),
      tx,
      withSpan,
    });
    return;
  }

  const result = await generatePageAdvisorSuggestions(tabId, {
    withSpan,
    onPhase: (message) => notifyContentPageAdvisor(tabId, { ok: true, phase: 'loading', message }),
    skillLoader: () => withSpan('prompt', () => loadDirectLlmSkill(sessionOk)),
    onLlmSpan: (id, startAbs, endAbs, status) => {
      if (!timingRun || typeof PageAdvisorTiming === 'undefined') return;
      PageAdvisorTiming.addClosedSpan(timingRun, id, startAbs, endAbs, status);
      broadcastPageAdvisorWaterfall(timingRun);
    },
    onSaasForward: (forward) => PageAdvisorTiming.applySaasForward(timingRun, forward),
  });

  if (!result.ok) {
    finishPageAdvisorTiming(timingRun, false, result.traceId || '');
    await notifyContentPageAdvisor(tabId, {
      ok: false,
      error: result.error,
      errorCode: result.errorCode || '',
      // 本地就挡住的路由（访客未配 Key 等）没有请求可追，不硬塞空 traceId。
      ...(result.traceId ? { traceId: result.traceId } : {}),
      ...(result.links ? { links: result.links } : {}),
    });
    return;
  }

  await notifyPageAdvisorDone(tabId, {
    ok: true,
    phase: 'done',
    jobId: result.jobId || '',
    pageUrl: result.pageUrl,
    suggestions: result.suggestions,
    featureParamsSource: result.featureParamsSource || '',
    traceId: result.traceId || '',
  }, withSpan, timingRun);
}
