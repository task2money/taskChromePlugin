/**
 * HAR 网络请求解析（纯函数，无 Chrome API 依赖）
 * DevTools 与 node --test 共用
 */

function headersToObject(headers) {
  if (!Array.isArray(headers)) return {};
  return headers.reduce((acc, h) => {
    if (h?.name) acc[h.name] = h.value ?? '';
    return acc;
  }, {});
}

/**
 * 判断 HAR 条目是否为 Canceled（客户端中止，非 HTTP 响应）
 */
function isCanceledHarEntry(entry) {
  const response = entry?.response || {};
  const status = response.status ?? 0;
  const statusText = String(response.statusText || '').toLowerCase();
  const errorText = String(entry?._errorText || response._error || '').toLowerCase();
  if (status === 0) return true;
  if (statusText.includes('cancel') || statusText.includes('abort')) return true;
  if (errorText.includes('err_aborted') || errorText.includes('abort')) return true;
  return false;
}

function harEntryKey(entry) {
  const started = entry?.startedDateTime || '';
  const method = entry?.request?.method || '';
  const url = entry?.request?.url || '';
  return `${started}\0${method}\0${url}`;
}

function defaultMakeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseHarTimestamp(entry) {
  if (entry?.startedDateTime) {
    const parsed = Date.parse(entry.startedDateTime);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function buildRequestFromHarEntry(entry, options = {}) {
  const makeId = options.makeId || defaultMakeId;
  const response = entry?.response || {};
  const canceled = isCanceledHarEntry(entry);
  const statusCode = canceled ? 0 : (response.status ?? 0);
  let statusText = response.statusText || '';
  if (canceled && !statusText) {
    statusText = 'Canceled';
  }

  let requestBody = '';
  if (entry?.request?.postData) {
    requestBody = entry.request.postData.text || '';
    if (!requestBody && Array.isArray(entry.request.postData.params)) {
      requestBody = entry.request.postData.params.map((p) => `${p.name}=${p.value}`).join('&');
    }
  }

  return {
    id: makeId(),
    harKey: harEntryKey(entry),
    method: entry?.request?.method || 'GET',
    url: entry?.request?.url || '',
    statusCode,
    statusText,
    canceled,
    type: entry?._resourceType || 'unknown',
    time: Math.round(entry?.time || 0),
    requestHeaders: headersToObject(entry?.request?.headers),
    responseHeaders: headersToObject(response.headers),
    mimeType: response.content?.mimeType || '',
    responseBody: response.content?.text || '',
    requestBody: requestBody || '',
    error: canceled ? (entry?._errorText || response._error || 'net::ERR_ABORTED') : '',
    timestamp: parseHarTimestamp(entry),
  };
}

/**
 * 将 HAR entries 补录进缓冲区，跳过已见过的 harKey
 * @returns {{ added: object[], skipped: number }}
 */
function mergeHarEntries(entries, seenHarKeys, options = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const added = [];
  let skipped = 0;

  for (const entry of list) {
    const key = harEntryKey(entry);
    if (!key || key === '\0\0') {
      skipped += 1;
      continue;
    }
    if (seenHarKeys.has(key)) {
      skipped += 1;
      continue;
    }
    const req = buildRequestFromHarEntry(entry, options);
    added.push(req);
  }

  return { added, skipped };
}

/**
 * 按 timestamp 排序并截断缓冲区
 */
function trimRequestBuffer(requests, maxSize) {
  if (!Array.isArray(requests) || requests.length <= maxSize) {
    return requests;
  }
  const sorted = [...requests].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return sorted.slice(sorted.length - maxSize);
}

/**
 * HAR 补录时是否值得异步 getContent 拉取 response body
 *
 * 之前的实现排除了 GET/HEAD + status<400 的请求以减少 getContent 调用，
 * 但这导致成功 GET 请求的响应体在补录时丢失 —— 用户无法在面板中查看响应体。
 * 现在对所有有 getContent 且尚未填充 body 的 entry 都尝试拉取。
 */
function shouldEnrichHarBody(req, entry) {
  if (!req || req.responseBody) return false;
  if (typeof entry?.getContent !== 'function') return false;
  return true;
}

/**
 * 从 HAR entries 构建 harKey → entry 索引
 */
function indexHarEntriesByKey(entries) {
  const map = new Map();
  if (!Array.isArray(entries)) return map;
  for (const entry of entries) {
    const key = harEntryKey(entry);
    if (key && key !== '\0\0') map.set(key, entry);
  }
  return map;
}

const HarRequest = {
  headersToObject,
  isCanceledHarEntry,
  harEntryKey,
  buildRequestFromHarEntry,
  mergeHarEntries,
  trimRequestBuffer,
  shouldEnrichHarBody,
  indexHarEntriesByKey,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HarRequest;
}
