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
 * 向 tab 顶层 frame 取页面上下文；失败则整 tab 广播。
 * @param {number} tabId
 */
async function askContentPageAdvisorContext(tabId) {
  const msg = { action: 'getPageAdvisorContext' };
  const wrap = (p) => (typeof withTimeout === 'function' ? withTimeout(p, 12000, 'getPageAdvisorContext') : p);
  try {
    return await wrap(chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }));
  } catch (frame0Err) {
    console.warn('[taskChromePlugin] getPageAdvisorContext frame0 失败，回退整 tab 广播:', frame0Err?.message || frame0Err);
    return await wrap(chrome.tabs.sendMessage(tabId, msg));
  }
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
