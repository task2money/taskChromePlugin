/**
 * DOM data-traceId 工具 — 请求失败错误展示元规则
 * 属性名必须为字面量 data-traceId（与 E2E / 运维排查约定一致）
 */

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
