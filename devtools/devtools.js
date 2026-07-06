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

async function enrichRequestBody(req, entry) {
  if (req.responseBody || typeof entry.getContent !== 'function') return req;
  try {
    const body = await new Promise((resolve) => {
      entry.getContent((content) => resolve(content || ''));
    });
    if (body) req.responseBody = body;
  } catch (_) { /* ignore */ }
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
        notifyRequestUpdated(req);
      }
    }));
  }

  return { enriched, attempted: slice.length };
}

async function ingestHarEntry(entry, options = {}) {
  const req = HarRequest.buildRequestFromHarEntry(entry);
  if (!pushRequest(req, { notifyPanel: options.notifyPanel !== false })) {
    return null;
  }
  if (options.enrichBody !== false) {
    const before = req.responseBody || '';
    await enrichRequestBody(req, entry);
    if ((req.responseBody || '') !== before) {
      notifyRequestUpdated(req);
    }
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
      const { added: candidates } = HarRequest.mergeHarEntries(entries, seenHarKeys);
      const actuallyAdded = [];
      let added = 0;

      for (const req of candidates) {
        if (pushRequest(req, { notifyPanel: options.notifyPanel !== false })) {
          added += 1;
          actuallyAdded.push(req);
        }
      }

      const enrichTargets = actuallyAdded
        .map((req) => ({ req, entry: entryIndex.get(req.harKey) }))
        .filter(({ req, entry }) => entry && HarRequest.shouldEnrichHarBody(req, entry));

      const enrichResult = enrichTargets.length > 0
        ? await enrichBackfillBodies(enrichTargets, options)
        : { enriched: 0, attempted: 0 };

      if (added > 0) {
        console.log(
          `[taskChromePlugin] HAR 补录 ${added} 条请求` +
          (enrichResult.enriched > 0 ? `，异步拉取 body ${enrichResult.enriched} 条` : '')
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
  const cutoff = Date.now() - 5 * 60 * 1000;
  while (recentRequests.length > 0 && recentRequests[0].timestamp < cutoff) {
    const removed = recentRequests.shift();
    if (removed?.harKey) seenHarKeys.delete(removed.harKey);
  }
}, 30000);

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
