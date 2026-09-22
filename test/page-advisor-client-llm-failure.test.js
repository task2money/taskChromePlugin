'use strict';

// OPT-20260922-035: 直连 LLM 失败上报的报文构造与 best-effort 语义。
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

require('./helpers/txRuntime.js').installTxRuntime();

const PageAdvisorAPI = require('../lib/page-advisor-api.js');
const PageAdvisorLLM = require('../lib/page-advisor-llm-client.js');

describe('PageAdvisorAPI client LLM failure payload', () => {
  it('endpoint is tenant-scoped under the v1 page-advisor prefix', () => {
    assert.equal(
      PageAdvisorAPI.ENDPOINTS.clientLlmFailures,
      '/api/page-advisor/v1/tenant_id/{tenantId}/client-llm-failures/',
    );
  });

  it('redacts the local api key and truncates both message and snippet', () => {
    const payload = PageAdvisorAPI.buildClientLlmFailurePayload({
      traceId: '  tid-1  ',
      errorCode: 'PLUGIN_DIRECT_LLM_FAILED',
      errorMessage: 'llm http 401: sk-local rejected',
      contentSnippet: `sk-local ${'x'.repeat(900)}`,
      model: 'deepseek-chat',
      apiKey: 'sk-local',
    });
    assert.equal(payload.trace_id, 'tid-1');
    assert.equal(payload.error_code, 'PLUGIN_DIRECT_LLM_FAILED');
    assert.equal(payload.model, 'deepseek-chat');
    assert.equal(payload.error_message.includes('sk-local'), false);
    assert.match(payload.error_message, /\[redacted-api-key\]/);
    assert.equal(payload.content_snippet.includes('sk-local'), false);
    assert.equal(payload.content_snippet.length, 500);
  });

  it('shared redactSnippet is what the payload builder uses', () => {
    const s = PageAdvisorLLM.redactSnippet('abc sk-1 def', 'sk-1', 100);
    assert.equal(s, 'abc [redacted-api-key] def');
  });
});

describe('PageAdvisorAPI reportClientLlmFailure (mocked fetch)', () => {
  let origFetch;
  const session = { baseUrl: 'https://api.example.com', token: 'at_test' };

  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = origFetch; });

  it('POSTs the client trace_id to the tenant observation path', async () => {
    let seen;
    globalThis.fetch = async (url, opts) => {
      seen = { url: String(url), opts };
      return {
        ok: true,
        status: 202,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'ok' }),
      };
    };
    const ok = await PageAdvisorAPI.reportClientLlmFailure(
      'ten1',
      { trace_id: 'd3f4601e-5b2d-45f6-b6d1-ff430f44f14a', error_code: 'PLUGIN_DIRECT_LLM_FAILED' },
      session,
    );
    assert.equal(ok, true);
    assert.equal(
      seen.url,
      'https://api.example.com/api/page-advisor/v1/tenant_id/ten1/client-llm-failures/',
    );
    assert.equal(seen.opts.method, 'POST');
    assert.equal(JSON.parse(seen.opts.body).trace_id, 'd3f4601e-5b2d-45f6-b6d1-ff430f44f14a');
  });

  it('swallows transport errors and returns false', async () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...a) => warnings.push(a);
    try {
      globalThis.fetch = async () => { throw new Error('network down'); };
      const ok = await PageAdvisorAPI.reportClientLlmFailure(
        'ten1',
        { trace_id: 'tid-x' },
        session,
      );
      assert.equal(ok, false);
    } finally {
      console.warn = origWarn;
    }
    assert.ok(warnings.some((a) => a[0] === '[taskChromePlugin] client_llm_failure_report_failed'));
  });

  it('skips the request without tenant or trace_id', async () => {
    let called = 0;
    globalThis.fetch = async () => { called += 1; return { ok: true, status: 202 }; };
    assert.equal(await PageAdvisorAPI.reportClientLlmFailure('', { trace_id: 't' }, session), false);
    assert.equal(await PageAdvisorAPI.reportClientLlmFailure('ten1', { trace_id: '  ' }, session), false);
    assert.equal(called, 0);
  });
});

describe('PageAdvisorAPI reportDirectLlmFailure (one-stop entry)', () => {
  let origFetch;
  const session = { baseUrl: 'https://api.example.com', token: 'at_test' };
  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = origFetch; });

  it('skips when not logged in or tenant missing', async () => {
    let called = 0;
    globalThis.fetch = async () => { called += 1; return { ok: true, status: 202 }; };
    assert.equal(await PageAdvisorAPI.reportDirectLlmFailure({
      sessionOk: false, tenantId: 'ten1', traceId: 't', err: new Error('x'),
    }, session), false);
    assert.equal(await PageAdvisorAPI.reportDirectLlmFailure({
      sessionOk: true, tenantId: '', traceId: 't', err: new Error('x'),
    }, session), false);
    assert.equal(called, 0);
  });

  it('posts the direct-LLM failure code with the client trace id', async () => {
    let seen;
    globalThis.fetch = async (url, opts) => {
      seen = { url: String(url), opts };
      return { ok: true, status: 202, headers: { get: () => 'application/json' }, json: async () => ({}) };
    };
    const ok = await PageAdvisorAPI.reportDirectLlmFailure({
      sessionOk: true,
      tenantId: 'ten1',
      traceId: 'tid-direct',
      err: { message: 'llm http 500: sk-local', snippet: 'sk-local' },
      model: 'deepseek-chat',
      apiKey: 'sk-local',
    }, session);
    assert.equal(ok, true);
    const body = JSON.parse(seen.opts.body);
    assert.equal(body.trace_id, 'tid-direct');
    assert.equal(body.error_code, 'PLUGIN_DIRECT_LLM_FAILED');
    assert.equal(body.model, 'deepseek-chat');
    assert.equal(JSON.stringify(body).includes('sk-local'), false);
  });
});
