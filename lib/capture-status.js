/**
 * 批量捕获状态码匹配（纯函数，无 Chrome API 依赖）
 */

const DEFAULT_CAPTURE_STATUS_PATTERNS = ['2xx', '3xx', '4xx', '5xx', 'canceled'];

/**
 * @param {number} statusCode
 * @param {string[]} patterns
 * @param {{ canceled?: boolean }} meta
 */
function matchStatusCode(statusCode, patterns, meta = {}) {
  for (const pattern of patterns || DEFAULT_CAPTURE_STATUS_PATTERNS) {
    if (pattern === 'canceled' && (meta.canceled || statusCode === 0)) return true;
    if (pattern === '2xx' && statusCode >= 200 && statusCode < 300) return true;
    if (pattern === '3xx' && statusCode >= 300 && statusCode < 400) return true;
    if (pattern === '4xx' && statusCode >= 400 && statusCode < 500) return true;
    if (pattern === '5xx' && statusCode >= 500 && statusCode < 600) return true;
    if (/^\d{3}$/.test(pattern) && parseInt(pattern, 10) === statusCode) return true;
  }
  return false;
}

const CaptureStatus = {
  DEFAULT_CAPTURE_STATUS_PATTERNS,
  matchStatusCode,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CaptureStatus;
}
