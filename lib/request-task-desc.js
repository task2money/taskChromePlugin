/**
 * 单请求 → 任务描述 Markdown（纯函数，供 Panel 与 node:test 共用）
 * 有 requestBody 时必须写入 **请求体** 段落；空则省略该段。
 */

function formatRequestAsTaskDescription(req, opts = {}) {
  const statusLabel = opts.statusLabel != null
    ? String(opts.statusLabel)
    : String(req.statusCode ?? '');
  const canceled = opts.canceled != null
    ? !!opts.canceled
    : !!(req.canceled || req.statusCode === 0);

  let d = `**请求**: ${req.method} ${req.url}\n**状态码**: ${statusLabel} ${req.statusText || ''}\n**耗时**: ${req.time || '?'}ms`;
  if (canceled && req.error) {
    d += `\n**错误**: ${req.error}`;
  }
  if (req.responseBody) {
    d += `\n\n**响应体**:\n\`\`\`\n${String(req.responseBody)}\n\`\`\``;
  }
  if (req.responseHeaders && Object.keys(req.responseHeaders).length) {
    d += `\n\n**响应头**:\n\`\`\`\n${Object.entries(req.responseHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\`\`\``;
  }
  if (req.requestBody) {
    d += `\n\n**请求体**:\n\`\`\`\n${String(req.requestBody)}\n\`\`\``;
  }
  if (req.requestHeaders && Object.keys(req.requestHeaders).length) {
    d += `\n\n**请求头**:\n\`\`\`\n${Object.entries(req.requestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\`\`\``;
  }
  return d;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatRequestAsTaskDescription };
}
if (typeof globalThis !== 'undefined') {
  globalThis.formatRequestAsTaskDescription = formatRequestAsTaskDescription;
}
