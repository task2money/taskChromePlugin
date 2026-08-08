/**
 * 捕获条目构建 — 按状态码分层存储字段（OPT-20260808-019 捕获条目瘦身）
 *
 * 背景：SW webRequest 捕获链路对每个请求（默认全状态码）保存完整请求/响应头，
 * 满仓 500 条时 session storage 数组可达 0.6-3MB，且每次请求全量读改写，
 * 造成扩展进程 CPU/内存写风暴（work-panel 等轮询密集型页面尤甚）。
 *
 * 策略：
 * - 2xx/3xx 成功请求：只存最小字段集，不存任何 headers（省 80-90% 体积，
 *   且避免成功请求的凭据/追踪头落存储）
 * - 4xx/5xx/canceled 错误请求：保留完整头（面板诊断展示），但裁剪敏感头
 *   （authorization/cookie/set-cookie/x-api-key 等不得进任务描述或存储）
 */

/** 敏感请求/响应头白名单外黑名单 — 大小写不敏感匹配 */
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
]);

/** 是否存储完整 headers：仅错误请求（4xx/5xx/canceled）保留诊断价值 */
function shouldStoreHeaders(statusCode, canceled) {
  if (canceled) return true;
  const code = Number(statusCode);
  return Number.isFinite(code) && code >= 400;
}

/** 裁剪敏感头，返回新对象（不修改入参） */
function redactHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(String(name).toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}

/**
 * 构建捕获条目（字段分层）。
 * 入参同原 SW buildCapturedEntry；capturedAt 由 Storage 层统一添加。
 */
function buildCapturedEntry(fields) {
  const base = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url: fields.url,
    method: fields.method,
    statusCode: fields.statusCode,
    statusLine: fields.statusLine || '',
    type: fields.type,
    timeStamp: fields.timeStamp,
    tabId: fields.tabId,
    canceled: !!fields.canceled,
    error: fields.error || '',
  };

  if (shouldStoreHeaders(fields.statusCode, fields.canceled)) {
    base.requestHeaders = redactHeaders(fields.requestHeaders);
    base.responseHeaders = redactHeaders(fields.responseHeaders);
  }
  return base;
}

const CapturedEntries = {
  SENSITIVE_HEADER_NAMES,
  shouldStoreHeaders,
  redactHeaders,
  buildCapturedEntry,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CapturedEntries;
}
if (typeof globalThis !== 'undefined') {
  globalThis.CapturedEntries = CapturedEntries;
}
