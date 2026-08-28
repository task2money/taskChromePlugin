/** Request capture, badge, tab tracking (OPT-20260821-004 split). */
// ---- 捕获配置内存缓存（OPT-20260808-023 F1）----
// 热路径（webRequest onCompleted/onErrorOccurred）原本对 <all_urls> 的每个请求
// 都执行一次 chrome.storage.local.get IPC——storage 服务是浏览器进程内跨页面共享的
// 资源，轮询密集页 × 多标签页下队列饱和会阻塞所有依赖 storage 的调用方。
// 首读后缓存；双失效点：1) setCaptureEnabled 主动失效；2) storage.onChanged 兜底
// 失效（覆盖 Popup 等外部写入路径）。
let captureCfgCache = null;

async function getCaptureConfigCached() {
  if (captureCfgCache) return captureCfgCache;
  captureCfgCache = await Storage.getCaptureConfig();
  return captureCfgCache;
}

function invalidateCaptureConfigCache() {
  captureCfgCache = null;
}

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.captureEnabled || changes.captureStatusCodes) {
      invalidateCaptureConfigCache();
    }
  });
}

// ---- 顶层注册 webRequest 监听器 (MV3 最佳实践) ----

chrome.webRequest.onCompleted.addListener(
  handleRequestCompleted,
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// Canceled / 中止请求不会触发 onCompleted，需监听 onErrorOccurred
chrome.webRequest.onErrorOccurred.addListener(
  handleRequestError,
  { urls: ['<all_urls>'] }
);

// POST/PUT 请求体：HAR 常省略 postData；用 onBeforeRequest + requestBody 短时缓存补齐。
// 禁止把完整 body 打进日志。MV3 必须顶层注册，否则 SW 休眠会漏捕。
const requestBodyCache = (typeof createRequestBodyCache === 'function')
  ? createRequestBodyCache({ ttlMs: 5 * 60 * 1000, maxEntries: 200 })
  : { put() {}, lookup() { return ''; } };

if (typeof chrome.webRequest?.onBeforeRequest?.addListener === 'function') {
  chrome.webRequest.onBeforeRequest.addListener(
    function captureRequestBody(details) {
      const captureOn = !captureCfgCache || !!captureCfgCache.enabled;
      if (typeof shouldCacheWebRequestBody === 'function'
        && !shouldCacheWebRequestBody(details, captureOn)) {
        return;
      }
      if (!details || details.tabId < 0) return;
      const body = (typeof decodeWebRequestBody === 'function')
        ? decodeWebRequestBody(details.requestBody)
        : '';
      if (!body) return;
      requestBodyCache.put({
        method: details.method,
        url: details.url,
        tabId: details.tabId,
        timeStamp: details.timeStamp,
        requestId: details.requestId,
        body,
      });
    },
    { urls: ['<all_urls>'], types: (typeof WEB_REQUEST_BODY_TYPES !== 'undefined')
      ? WEB_REQUEST_BODY_TYPES
      : ['xmlhttprequest', 'main_frame', 'sub_frame', 'other'] },
    ['requestBody']
  );
}

// 5xx per-tab badge counters — Map<tabId, count>
const tab5xxCounts = new Map();
let activeTabId = -1;

// Track active tab changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  updateBadgeForActiveTab();
});

// Track tab closes — clean up
chrome.tabs.onRemoved.addListener((tabId) => {
  tab5xxCounts.delete(tabId);
  tabUrlCache.delete(tabId);
});

// OPT-20260808-023 F4: Memory Saver（Chrome 96+）discard 的标签页不触发 onRemoved，
// 但页面已冻结，Map 条目须在 discard 时同步清理（避免残留 + 卡死页不参与广播目标）
if (typeof chrome.tabs?.onDiscarded?.addListener === 'function') {
  chrome.tabs.onDiscarded.addListener((tabId) => {
    tab5xxCounts.delete(tabId);
    tabUrlCache.delete(tabId);
  });
}

// 跟踪 tab URL 变化 — 检测页面刷新/导航
const tabUrlCache = new Map();

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  const prevUrl = tabUrlCache.get(tabId);
  tabUrlCache.set(tabId, changeInfo.url);
  if (!prevUrl) return;
  if (prevUrl === changeInfo.url) return;

  const trackingCfg = await Storage.getTrackingConfig();
  if (!trackingCfg.enabled) {
    // 清空存储同时丢弃合批缓冲中未写入的条目，避免下一轮 flush 回写
    capturedBuffer.discard();
    await Storage.clearCapturedErrors();
    if (activeTabId === tabId) {
      tab5xxCounts.set(tabId, 0);
      updateBadgeForActiveTab();
    }
  }
});

async function updateBadgeForActiveTab() {
  const count = tab5xxCounts.get(activeTabId) || 0;
  if (count > 0) {
    await chrome.action.setBadgeText({ text: String(count) });
    await chrome.action.setBadgeBackgroundColor({ color: '#f38ba8' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

/** 5xx 徽标更新去抖（500ms 合批）— 轮询密集型页面每请求一次 chrome.action 是多余开销 */
let badgeUpdateTimer = null;
function scheduleBadgeUpdate() {
  if (badgeUpdateTimer) return;
  badgeUpdateTimer = setTimeout(() => {
    badgeUpdateTimer = null;
    updateBadgeForActiveTab();
  }, 500);
}

/**
 * 处理完成的请求 — 按 tab 隔离计数，按 capture 配置存储详情
 * （OPT-20260808-019：条目入合批缓冲，1s 节流批量写入，见 capturedBuffer）
 */
async function handleRequestCompleted(details) {
  try {
    const tabId = details.tabId;
    if (tabId < 0) return;

    // 角标示数仅计 5xx（与捕获配置无关；4xx/Canceled 不计入）
    if (CaptureStatus.isHttp5xx(details.statusCode)) {
      const prev = tab5xxCounts.get(tabId) || 0;
      tab5xxCounts.set(tabId, prev + 1);
      if (tabId === activeTabId) {
        scheduleBadgeUpdate();
      }
    }

    // 缓存命中且关闭捕获：同步返回，避免每个 2xx 轮询都 await storage
    if (captureCfgCache && !captureCfgCache.enabled) return;

    const captureCfg = await getCaptureConfigCached();
    if (!captureCfg.enabled) return;

    const isError = CaptureStatus.matchStatusCode(details.statusCode, captureCfg.statusCodes, { canceled: false });
    if (!isError) return;

    const entry = CapturedEntries.buildCapturedEntry({
      url: details.url,
      method: details.method,
      statusCode: details.statusCode,
      statusLine: details.statusLine || '',
      type: details.type,
      timeStamp: details.timeStamp,
      tabId,
      requestHeaders: extractHeaders(details.requestHeaders),
      responseHeaders: extractHeaders(details.responseHeaders),
      canceled: false,
      error: '',
    });

    capturedBuffer.push(entry);
  } catch (_) {
    // 静默处理 storage 读取失败
  }
}

/**
 * 处理 Canceled / 网络错误请求 — webRequest.onCompleted 不会触发
 */
async function handleRequestError(details) {
  try {
    if (details.error !== 'net::ERR_ABORTED') return;

    const tabId = details.tabId;
    if (tabId < 0) return;

    if (captureCfgCache && !captureCfgCache.enabled) return;

    const captureCfg = await getCaptureConfigCached();
    if (!captureCfg.enabled) return;

    const canceled = true;
    const statusCode = 0;
    const statusLine = 'Canceled';

    const isMatch = CaptureStatus.matchStatusCode(statusCode, captureCfg.statusCodes, { canceled });
    if (!isMatch) return;

    const entry = CapturedEntries.buildCapturedEntry({
      url: details.url,
      method: details.method,
      statusCode,
      statusLine,
      type: details.type,
      timeStamp: details.timeStamp,
      tabId,
      requestHeaders: {},
      responseHeaders: {},
      canceled,
      error: details.error || '',
    });

    capturedBuffer.push(entry);
  } catch (_) {
    // 静默处理 storage 读取失败
  }
}

function extractHeaders(headers) {
  if (!headers) return {};
  const obj = {};
  for (const h of headers) {
    obj[h.name] = h.value;
  }
  return obj;
}

// ---- 捕获条目合批缓冲（OPT-20260808-019）----
// 每个请求只入内存队列，1s 节流批量写入 session storage。
// 修复前：每个请求都做一次「读 500 条数组 → push → 全量写回」，
// work-panel 等轮询密集页面每分钟数十次请求 → 每次 1MB+ JSON parse/stringify
// 写风暴 + storage.onChanged 广播风暴。修复后每请求零 storage 读写，
// 至多每秒一次批量写（Storage.addCapturedErrors 内部仍有 500 条上限）。
const capturedBuffer = CapturedBuffer.createCapturedBuffer({
  flush: (batch) => Storage.addCapturedErrors(batch),
  flushIntervalMs: 1000,
  maxEntries: 500,
});
