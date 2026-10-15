/**
 * 自动创新直连：用当前表单对 OpenAI 兼容 chat/completions 做一次最短连通探测。
 * 不写本机 Key。失败带 traceId，文案不得含 API Key。
 */

'use strict';

const PageAdvisorLlmProbe = (() => {
  function joinChatCompletionsURL(baseURL) {
    if (typeof PageAdvisorLLM !== 'undefined' && typeof PageAdvisorLLM.joinChatCompletionsURL === 'function') {
      return PageAdvisorLLM.joinChatCompletionsURL(baseURL);
    }
    const u = String(baseURL || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (u.endsWith('/chat/completions')) return u;
    if (u.endsWith('/v1')) return `${u}/chat/completions`;
    return `${u}/v1/chat/completions`;
  }

  function redact(text, apiKey) {
    let s = String(text || '');
    const key = String(apiKey || '').trim();
    if (key) s = s.split(key).join('[redacted-api-key]');
    if (s.length > 180) s = s.slice(0, 180);
    return s;
  }

  /**
   * 记一次连通性探测到本机账本（OPT-20261015-022 Action 3）。
   *
   * 只记主机与结果，不记正文：探针带的是用户自填的同一个 Key，页面正文并没有跟着
   * 出门，账本要回答的是「拿这个 Key 试过哪些主机、成没成」。记账是旁路，账本不在
   * 或写失败都不影响探测本身。
   */
  async function noteProbeLedger(fields) {
    try {
      const ledger = typeof globalThis !== 'undefined' ? globalThis.PageAdvisorLLMLedger : null;
      if (!ledger || typeof ledger.recordCall !== 'function') return;
      // 与直连路径同款：等落盘再返回，避免 popup 关闭时丢掉这条记录。
      await ledger.recordCall(Object.assign({ source: 'probe' }, fields));
    } catch (_) {
      /* 记账失败不影响探测 */
    }
  }

  function fail(code, message, extra) {
    const err = new Error(message);
    err.code = code;
    if (extra && extra.traceId) err.traceId = extra.traceId;
    if (extra && extra.status != null) err.status = extra.status;
    return err;
  }

  function newTraceId() {
    if (typeof APIHttp !== 'undefined' && typeof APIHttp.newRequestTraceId === 'function') {
      return APIHttp.newRequestTraceId();
    }
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (_) { /* ignore */ }
    return `plugin-${Date.now()}`;
  }

  function resolveTrace(res, requestTraceId, bodyText) {
    if (typeof APIHttp !== 'undefined' && typeof APIHttp.resolveTraceId === 'function') {
      return APIHttp.resolveTraceId(res, requestTraceId, bodyText) || requestTraceId || '';
    }
    const fromHeader = res?.headers?.get?.('X-Trace-Id') || res?.headers?.get?.('x-trace-id');
    if (fromHeader && String(fromHeader).trim()) return String(fromHeader).trim();
    return requestTraceId || '';
  }

  function endpointOf(baseUrl) {
    const raw = joinChatCompletionsURL(baseUrl);
    let url;
    try {
      url = new URL(raw);
    } catch (_) {
      throw fail('bad_url', 'bad url');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw fail('bad_url', 'bad url');
    }
    if (url.username || url.password) {
      throw fail('bad_url', 'bad url');
    }
    return url.toString();
  }

  function providerDetail(text, apiKey) {
    const raw = String(text || '');
    try {
      const body = JSON.parse(raw);
      const msg = body?.error?.message || body?.message || '';
      if (msg) return redact(String(msg), apiKey);
    } catch (_) { /* not json */ }
    return redact(raw, apiKey);
  }

  /**
   * OPT-20260929-006: 400 是否为「上游只认 max_completion_tokens」的参数不兼容。
   * 只看错误文案本身，不对状态码以外的响应形状做假设。
   * "max_completion_tokens" 并不含子串 "max_tokens"，故不会误命中。
   */
  function mentionsMaxTokens(text) {
    const raw = String(text || '');
    let msg = raw;
    try {
      const body = JSON.parse(raw);
      msg = body?.error?.message || body?.message || raw;
    } catch (_) { /* not json */ }
    return /max_tokens/.test(String(msg));
  }

  function probeStatusView(err, okModel) {
    if (!err) {
      return {
        failed: false,
        textKey: 'paLlmTestOk',
        params: { model: okModel || '' },
        traceId: '',
        detail: '',
      };
    }
    if (err.code === 'incomplete') {
      return { failed: false, textKey: 'paLlmProfileNeedFields', params: null, traceId: '', detail: '' };
    }
    if (err.code === 'bad_url') {
      return { failed: false, textKey: 'paLlmTestBadUrl', params: null, traceId: '', detail: '' };
    }
    if (err.code === 'timeout') {
      return { failed: true, textKey: 'paLlmTestTimeout', params: null, traceId: err.traceId || '', detail: '' };
    }
    if (err.code === 'network') {
      return { failed: true, textKey: 'paLlmTestNetwork', params: null, traceId: err.traceId || '', detail: '' };
    }
    return {
      failed: true,
      textKey: 'paLlmTestFail',
      params: { detail: err.message || '' },
      traceId: err.traceId || '',
      detail: err.message || '',
    };
  }

  function renderProbeStatus(el, state) {
    if (!el) return;
    const failed = Boolean(state && state.failed);
    const traceId = failed ? String((state && state.traceId) || '').trim() : '';
    const text = String((state && state.text) || '');
    const shown = traceId && typeof formatErrorWithTraceId === 'function'
      ? formatErrorWithTraceId(text, traceId)
      : text;
    el.textContent = shown;
    if (typeof setDataTraceId === 'function') setDataTraceId(el, traceId);
  }

  /**
   * @param {{ apiKey?: string, baseUrl?: string, model?: string }} creds
   * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, traceId?: string, idempotencyKey?: string }} [opts]
   */
  async function probeLlmConnectivity(creds, opts = {}) {
    const apiKey = String(creds?.apiKey || '').trim();
    const baseUrl = String(creds?.baseUrl || '').trim();
    const model = String(creds?.model || '').trim();
    if (!apiKey || !baseUrl || !model) {
      throw fail('incomplete', 'incomplete');
    }
    const endpoint = endpointOf(baseUrl);
    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    const timeoutMs = opts.timeoutMs ?? 20000;
    // 账本用的起点（OPT-20261015-022）：与 noteProbeLedger 的 durationMs 配对。
    const t0 = Date.now();
    const requestTraceId = opts.traceId || newTraceId();
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Trace-Id': requestTraceId,
    };
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    let host = '';
    try { host = new URL(endpoint).host; } catch (_) { /* ignore */ }
    let res;
    let text;
    // OPT-20260929-006: 上游只认 max_completion_tokens 时用同一幂等键换参重试一次（至多两次请求）。
    const payloads = [
      { model, max_tokens: 1, temperature: 0, messages: [{ role: 'user', content: 'ping' }] },
      { model, max_completion_tokens: 1, temperature: 0, messages: [{ role: 'user', content: 'ping' }] },
    ];
    let attempt = 0;
    try {
      for (;;) {
        try {
          res = await fetchImpl(endpoint, {
            method: 'POST',
            headers,
            credentials: 'omit',
            body: JSON.stringify(payloads[attempt]),
            signal: ctrl ? ctrl.signal : undefined,
          });
        } catch (networkErr) {
          const aborted = networkErr && (networkErr.name === 'AbortError');
          const err = fail(aborted ? 'timeout' : 'network', aborted ? 'timeout' : 'network', {
            traceId: requestTraceId,
          });
          console.warn('[taskChromePlugin] llm_connectivity_failed', {
            trace_id: requestTraceId,
            code: err.code,
            host,
          });
          // 连通性测试也是往外发请求（同一个自填 Key），超时/网络失败同样要留痕。
          await noteProbeLedger({ baseUrl, model, ok: false, status: 0, durationMs: Date.now() - t0 });
          throw err;
        }
        text = await res.text();
        if (attempt !== 0 || res.status !== 400 || !mentionsMaxTokens(text)) break;
        attempt = 1;
        console.warn('[taskChromePlugin] llm_connectivity_retry_max_completion_tokens', {
          trace_id: resolveTrace(res, requestTraceId, text) || requestTraceId,
          host,
        });
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
    const traceId = resolveTrace(res, requestTraceId, text);
    // 探针只记主机与结果，不记正文（OPT-20261015-022 Action 3）：它带着同一个 Key
    // 出门，用户需要知道「试过哪些主机、成没成」，不需要把 ping 的回包也存下来。
    await noteProbeLedger({
      baseUrl,
      model,
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - t0,
    });
    if (!res.ok) {
      const detail = providerDetail(text, apiKey);
      const err = fail('http', detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`, {
        status: res.status,
        traceId,
      });
      console.warn('[taskChromePlugin] llm_connectivity_failed', {
        trace_id: traceId,
        code: 'http',
        status: res.status,
        host,
      });
      throw err;
    }
    console.info('[taskChromePlugin] llm_connectivity_ok', {
      trace_id: traceId,
      status: res.status,
      model,
      host,
    });
    return { ok: true, model, status: res.status, traceId };
  }

  return {
    joinChatCompletionsURL,
    probeLlmConnectivity,
    probeStatusView,
    renderProbeStatus,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorLlmProbe;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorLlmProbe = PageAdvisorLlmProbe;
}
