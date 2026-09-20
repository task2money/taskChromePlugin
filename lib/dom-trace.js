/**
 * DOM data-traceId 工具 — 请求失败错误展示元规则
 * 属性名必须为字面量 data-traceId（与 E2E / 运维排查约定一致）
 */

if (!globalThis.__taskpluginContentBoot?.skip) {
function extractTraceId(source) {
  if (source == null || source === '') return '';
  if (typeof source === 'string') return source.trim();
  const tid = source.traceId ?? source.trace_id;
  if (tid == null) return '';
  return String(tid).trim();
}

function setDataTraceId(el, source) {
  if (!el) return;
  const tid = extractTraceId(source);
  if (tid) {
    el.setAttribute('data-traceId', tid);
  } else {
    el.removeAttribute('data-traceId');
  }
}
// formatErrorWithTraceId 让失败文案在纯文本复制后仍可检索（约束 24）：
// data-traceId 只是 DOM 属性，用户把 message 粘进聊天时 Agent 提取不到 trace。
// 已有 traceId 文案则不重复追加。
function formatErrorWithTraceId(msg, source) {
  const text = String(msg == null ? '' : msg);
  const tid = extractTraceId(source);
  if (!text || !tid) return text;
  if (/\btrace[_-]?id\s*[:=]/i.test(text)) return text;
  return `${text}\ntraceId: ${tid}`;
}

if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    extractTraceId, setDataTraceId, formatErrorWithTraceId,
  });
}
}
