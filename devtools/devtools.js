/**
 * DevTools 入口脚本
 * - 创建 TaskPlugin 面板
 * - 监听网络请求，通过 postMessage 直接发送给 Panel
 * - 同时转发到 background service worker（供 Popup 使用）
 * - DevTools 晚开时通过 getHAR() 补录历史请求
 */

const recentRequests = [];
const seenHarKeys = new Set();
const MAX_BUFFER = 200;
const MAX_SEEN_KEYS = 2000;
const CLEANUP_WINDOW_MS = 5 * 60 * 1000; // 清理线程的过期窗口（与下方 setInterval 一致）
const BACKFILL_ENRICH_MAX = 25;
const BACKFILL_ENRICH_CONCURRENCY = 5;
let panelWindowRef = null;
let backfillInFlight = null;

function rememberHarKey(key) {
  if (!key) return;
  seenHarKeys.add(key);
  if (seenHarKeys.size > MAX_SEEN_KEYS) {
    const drop = seenHarKeys.size - MAX_SEEN_KEYS;
    const iter = seenHarKeys.values();
    for (let i = 0; i < drop; i += 1) {
      const next = iter.next();
      if (next.done) break;
      seenHarKeys.delete(next.value);
    }
  }
}

function pushRequest(req, { notifyPanel = true } = {}) {
  if (req.harKey) {
    if (seenHarKeys.has(req.harKey)) return false;
    rememberHarKey(req.harKey);
  }

  recentRequests.push(req);
  const trimmed = HarRequest.trimRequestBuffer(recentRequests, MAX_BUFFER);
  if (trimmed !== recentRequests) {
    recentRequests.length = 0;
    recentRequests.push(...trimmed);
  }

  if (notifyPanel && panelWindowRef) {
    try {
      panelWindowRef.postMessage({ action: 'newRequest', request: req }, '*');
    } catch (_) { /* ignore */ }
  }

  chrome.runtime.sendMessage({
    action: 'addRecentRequest',
    request: req,
  }).catch(() => {});

  return true;
}

function notifyRequestUpdated(req) {
  if (!panelWindowRef) return;
  try {
    panelWindowRef.postMessage({ action: 'requestUpdated', request: req }, '*');
  } catch (_) { /* ignore */ }

  chrome.runtime.sendMessage({
    action: 'updateRecentRequest',
    request: req,
  }).catch(() => {});
}

function pushPanelInitRequests() {
  if (!panelWindowRef) return;
  try {
    panelWindowRef.postMessage({
      action: 'initRequests',
      requests: [...recentRequests],
    }, '*');
  } catch (_) { /* ignore */ }
}

/**
 * 通过 entry.getContent() 异步拉取响应体并回填到 req.responseBody。
 * 注意：函数名保留为 enrichRequestBody 与历史调用兼容，
 * 实际填充的是 responseBody（即响应体），而非请求体。
 */
async function enrichRequestBody(req, entry) {
  if (req.responseBody || typeof entry.getContent !== 'function') return req;
  try {
    const body = await new Promise((resolve) => {
      entry.getContent((content, encoding) => {
        // encoding 为 "base64" 时表示二进制内容，保留原样（面板会以文本显示）
        resolve(content || '');
      });
    });
    if (body) req.responseBody = body;
  } catch (e) {
    // 不要静默吞没 —— 响应体获取失败是诊断网络问题的关键信号
    console.warn('[taskChromePlugin] getContent 获取响应体失败:', e?.message || e, req.url);
  }
  return req;
}

async function enrichBackfillBodies(targets, options = {}) {
  const max = options.maxEnrich ?? BACKFILL_ENRICH_MAX;
  const concurrency = options.concurrency ?? BACKFILL_ENRICH_CONCURRENCY;
  const slice = targets.slice(0, max);
  let enriched = 0;

  for (let i = 0; i < slice.length; i += concurrency) {
    const batch = slice.slice(i, i + concurrency);
    await Promise.all(batch.map(async ({ req, entry }) => {
      const before = req.responseBody || '';
      await enrichRequestBody(req, entry);
      if ((req.responseBody || '') !== before) {
        enriched += 1;
        // body 已在 push 之前填充完毕，无需 notifyRequestUpdated
      }
    }));
  }

  return { enriched, attempted: slice.length };
}

async function fillRequestBodyFromSw(req) {
  if (req.requestBody) return req;
  try {
    const tabId = chrome.devtools && chrome.devtools.inspectedWindow
      ? chrome.devtools.inspectedWindow.tabId
      : undefined;
    const res = await chrome.runtime.sendMessage({
      action: 'lookupRequestBody',
      method: req.method,
      url: req.url,
      tabId,
      timestamp: req.timestamp,
    });
    if (res && res.success && res.body) {
      req.requestBody = res.body;
    }
  } catch (e) {
    console.warn('[taskChromePlugin] lookupRequestBody 失败:', e && e.message ? e.message : e);
  }
  return req;
}

async function ingestHarEntry(entry, options = {}) {
  const req = HarRequest.buildRequestFromHarEntry(entry);
  // 先 enrich body，再推送 —— 消除竞态条件，确保 panel 收到完整请求
  if (options.enrichBody !== false) {
    await enrichRequestBody(req, entry);
  }
  await fillRequestBodyFromSw(req);
  if (!pushRequest(req, { notifyPanel: options.notifyPanel !== false })) {
    return null;
  }
  return req;
}

/**
 * 从 chrome.devtools.network.getHAR() 补录 DevTools 晚开时错过的请求
 */
async function backfillFromHar(options = {}) {
  if (backfillInFlight) return backfillInFlight;

  backfillInFlight = (async () => {
    try {
      const har = await chrome.devtools.network.getHAR();
      const entries = har?.log?.entries || [];
      const entryIndex = HarRequest.indexHarEntriesByKey(entries);
      const { added: mergedCandidates } = HarRequest.mergeHarEntries(entries, seenHarKeys);
      // 清理线程每 30s 会把超过 CLEANUP_WINDOW_MS 的请求移出缓冲区并遗忘 harKey；
      // 若补录时把这些旧条目重新加入，panel 列表会出现重复项。与清理窗口对齐跳过，
      // 同时对仍在缓冲区内的请求按 harKey 去重（seenHarKeys 逐出后它们可能被再次补录）。
      const candidates = HarRequest.filterBackfillCandidates(mergedCandidates, {
        cutoffMs: Date.now() - CLEANUP_WINDOW_MS,
        knownKeys: new Set(recentRequests.map((r) => r.harKey).filter(Boolean)),
      });

      // 先 enrich body，再推送 —— 消除竞态，确保 panel 收到完整请求
      const enrichTargets = candidates
        .map((req) => ({ req, entry: entryIndex.get(req.harKey) }))
        .filter(({ req, entry }) => entry && HarRequest.shouldEnrichHarBody(req, entry));

      const enrichResult = enrichTargets.length > 0
        ? await enrichBackfillBodies(enrichTargets, options)
        : { enriched: 0, attempted: 0 };

      let added = 0;
      for (const req of candidates) {
        await fillRequestBodyFromSw(req);
        if (pushRequest(req, { notifyPanel: options.notifyPanel !== false })) {
          added += 1;
        }
      }

      if (added > 0) {
        console.log(
          `[taskChromePlugin] HAR 补录 ${added} 条请求` +
          (enrichResult.enriched > 0 ? `，拉取 body ${enrichResult.enriched} 条` : '')
        );
      }
      return { added, ...enrichResult };
    } catch (err) {
      console.warn('[taskChromePlugin] HAR 补录失败:', err);
      return { added: 0, error: err?.message };
    } finally {
      backfillInFlight = null;
    }
  })();

  return backfillInFlight;
}

chrome.devtools.network.onRequestFinished.addListener(async (entry) => {
  try {
    await ingestHarEntry(entry);
  } catch (err) {
    console.error('[taskChromePlugin] 解析网络请求失败:', err, entry?.request?.url);
  }
});

chrome.devtools.network.onNavigated.addListener(() => {
  backfillFromHar({ notifyPanel: !!panelWindowRef }).then(() => {
    pushPanelInitRequests();
  });
});

// 清理过期请求 (每30秒)
setInterval(() => {
  const cutoff = Date.now() - CLEANUP_WINDOW_MS;
  while (recentRequests.length > 0 && recentRequests[0].timestamp < cutoff) {
    const removed = recentRequests.shift();
    if (removed?.harKey) seenHarKeys.delete(removed.harKey);
  }
}, 30000);

// 面板「🗑️ 清空列表」：清空本页缓冲并通知 panel；保留 seenHarKeys 防 HAR 补录复活
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action !== 'clearRecentRequests') return;
  recentRequests.length = 0;
  pushPanelInitRequests();
});

// 创建面板
chrome.devtools.panels.create(
  'TaskPlugin',
  '../icons/icon16.png',
  '../panel/panel.html',
  (panel) => {
    console.log('[taskChromePlugin] DevTools panel created');
    backfillFromHar({ notifyPanel: false });

    panel.onShown.addListener((panelWindow) => {
      panelWindowRef = panelWindow;
      backfillFromHar({ notifyPanel: false }).finally(() => {
        pushPanelInitRequests();
      });
    });
  }
);
