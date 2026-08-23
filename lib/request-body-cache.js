/**
 * webRequest 请求体解码与短时缓存（纯函数，SW / node:test 共用）
 * 禁止把完整 body 打进日志。
 */

function normalizeUrlForBodyMatch(url) {
  const s = String(url || '');
  const hash = s.indexOf('#');
  return hash === -1 ? s : s.slice(0, hash);
}

function bytesToUtf8(bytes) {
  if (!bytes) return '';
  if (typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function' && Buffer.isBuffer(bytes)) {
    return bytes.toString('utf8');
  }
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  if (typeof TextDecoder === 'undefined') {
    return Array.from(view, (b) => String.fromCharCode(b)).join('');
  }
  return new TextDecoder('utf-8').decode(view);
}

function decodeWebRequestBody(requestBody) {
  if (!requestBody || requestBody.error) return '';
  if (requestBody.formData && typeof requestBody.formData === 'object') {
    const parts = [];
    for (const [key, vals] of Object.entries(requestBody.formData)) {
      const arr = Array.isArray(vals) ? vals : [vals];
      for (const v of arr) {
        parts.push(`${key}=${v}`);
      }
    }
    return parts.join('&');
  }
  if (Array.isArray(requestBody.raw)) {
    const chunks = [];
    for (const part of requestBody.raw) {
      const bytes = part && (part.bytes || part.bytes);
      if (bytes) chunks.push(bytesToUtf8(bytes));
      else if (part && part.file) chunks.push(`[file:${part.file}]`);
    }
    return chunks.join('');
  }
  return '';
}

function createRequestBodyCache(opts = {}) {
  const ttlMs = opts.ttlMs || 5 * 60 * 1000;
  const maxEntries = opts.maxEntries || 200;
  const maxBodyBytes = opts.maxBodyBytes || 256 * 1024;
  const entries = [];

  function put(item) {
    let body = String(item.body || '');
    if (body.length > maxBodyBytes) {
      body = `${body.slice(0, maxBodyBytes)}\n…[truncated]`;
    }
    entries.push({
      method: String(item.method || '').toUpperCase(),
      url: normalizeUrlForBodyMatch(item.url),
      tabId: item.tabId,
      timeStamp: item.timeStamp || Date.now(),
      // webRequest requestId：并发同 URL 请求精确对齐，不依赖时间窗
      requestId: item.requestId || '',
      body,
    });
    while (entries.length > maxEntries) entries.shift();
  }

  function lookup(query) {
    const method = String(query.method || '').toUpperCase();
    const url = normalizeUrlForBodyMatch(query.url);
    const ts = query.timestamp || 0;
    // 查询方带 requestId 时优先精确匹配，避免同标签页并发同 URL 把 body 配错
    if (query.requestId) {
      for (const e of entries) {
        if (e.requestId && e.requestId === query.requestId) {
          return e.body;
        }
      }
    }
    // 无 requestId 或未命中时回退 method+url+tabId+时间窗匹配
    let best = null;
    let bestDelta = Infinity;
    for (const e of entries) {
      if (e.method !== method) continue;
      if (e.url !== url) continue;
      if (query.tabId != null && e.tabId != null && e.tabId !== query.tabId) continue;
      const delta = Math.abs((e.timeStamp || 0) - ts);
      if (delta > ttlMs) continue;
      if (delta < bestDelta) {
        best = e;
        bestDelta = delta;
      }
    }
    return best ? best.body : '';
  }

  return { put, lookup };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    decodeWebRequestBody,
    createRequestBodyCache,
    normalizeUrlForBodyMatch,
  };
}
if (typeof globalThis !== 'undefined') {
  globalThis.decodeWebRequestBody = decodeWebRequestBody;
  globalThis.createRequestBodyCache = createRequestBodyCache;
  globalThis.normalizeUrlForBodyMatch = normalizeUrlForBodyMatch;
}
