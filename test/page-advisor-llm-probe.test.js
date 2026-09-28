'use strict';

/**
 * 自动创新智能体：保存配置旁的「测试连通性」。
 * 用当前表单的 Base URL / 模型 / API Key 发一次最短 chat/completions。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

require('../lib/dom-trace.js');
const { zh, en } = require('../lib/i18n-llm-route.js');
const Probe = require('../lib/page-advisor-llm-probe.js');

const ROOT = path.join(__dirname, '..');

function popupLlmFields() {
  const html = fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
  const llm = html.match(/id="pageAdvisorLlmSection"[\s\S]*?<\/section>/)[0];
  const fieldsIdx = llm.indexOf('id="pageAdvisorLlmFields"');
  const statusIdx = llm.indexOf('id="popupLlmStatus"');
  return llm.slice(fieldsIdx, statusIdx);
}

function fakeStatus() {
  const attrs = {};
  return {
    textContent: '',
    setAttribute(k, v) { attrs[k] = v; },
    removeAttribute(k) { delete attrs[k]; },
    getAttribute(k) { return attrs[k]; },
  };
}

describe('LLM connectivity probe', () => {
  it('Probe-T1 缺字段不发请求，且不带 traceId', async () => {
    let called = 0;
    await assert.rejects(
      () => Probe.probeLlmConnectivity(
        { apiKey: '', baseUrl: 'https://api.example.com/v1', model: 'm' },
        { fetchImpl: async () => { called += 1; } },
      ),
      (err) => err && err.code === 'incomplete' && !err.traceId,
    );
    assert.equal(called, 0);
  });

  it('Probe-T2 非 http(s) 地址不发请求', async () => {
    let called = 0;
    await assert.rejects(
      () => Probe.probeLlmConnectivity(
        { apiKey: 'sk-test', baseUrl: 'javascript:alert(1)', model: 'm' },
        { fetchImpl: async () => { called += 1; } },
      ),
      (err) => err && err.code === 'bad_url' && !err.traceId,
    );
    assert.equal(called, 0);
  });

  it('Probe-T3 2xx 视为连通，请求带 Key、模型、幂等键与 X-Trace-Id', async () => {
    let seen;
    const result = await Probe.probeLlmConnectivity(
      { apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      {
        traceId: 'trace-probe-1',
        idempotencyKey: 'ik-probe-1',
        fetchImpl: async (url, opts) => {
          seen = { url, opts };
          return {
            ok: true,
            status: 200,
            headers: { get: () => '' },
            text: async () => '{"choices":[{"message":{"content":"ok"}}]}',
          };
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.model, 'deepseek-chat');
    assert.equal(seen.url, 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(seen.opts.method, 'POST');
    assert.equal(seen.opts.credentials, 'omit');
    assert.equal(seen.opts.headers.Authorization, 'Bearer sk-test');
    assert.equal(seen.opts.headers['Idempotency-Key'], 'ik-probe-1');
    assert.equal(seen.opts.headers['X-Trace-Id'], 'trace-probe-1');
    const body = JSON.parse(seen.opts.body);
    assert.equal(body.model, 'deepseek-chat');
    assert.equal(body.max_tokens, 1);
    assert.equal(body.messages[0].content, 'ping');
  });

  it('Probe-T4 HTTP 失败回传响应 trace，文案不含 API Key', async () => {
    await assert.rejects(
      () => Probe.probeLlmConnectivity(
        { apiKey: 'sk-test-secret', baseUrl: 'https://llm.test/v1', model: 'm' },
        {
          traceId: 'trace-sent',
          fetchImpl: async () => ({
            ok: false,
            status: 401,
            headers: { get: (name) => (String(name).toLowerCase() === 'x-trace-id' ? 'trace-from-upstream' : '') },
            text: async () => '{"error":{"message":"invalid key sk-test-secret"}}',
          }),
        },
      ),
      (err) => {
        assert.equal(err.code, 'http');
        assert.equal(err.status, 401);
        assert.equal(err.traceId, 'trace-from-upstream');
        assert.equal(String(err.message).includes('sk-test-secret'), false);
        assert.match(err.message, /\[redacted-api-key\]/);
        return true;
      },
    );
  });

  it('Probe-T5 网络失败沿用本端 X-Trace-Id', async () => {
    await assert.rejects(
      () => Probe.probeLlmConnectivity(
        { apiKey: 'sk-test', baseUrl: 'https://llm.test/v1', model: 'm' },
        {
          traceId: 'trace-local',
          fetchImpl: async () => { throw new Error('fetch failed'); },
        },
      ),
      (err) => err && err.code === 'network' && err.traceId === 'trace-local',
    );
  });

  it('Probe-T6 失败状态行带 data-traceId；校验失败不带', () => {
    const failEl = fakeStatus();
    const failView = Probe.probeStatusView({ code: 'http', message: 'HTTP 401', traceId: 'tid-9' }, '');
    Probe.renderProbeStatus(failEl, {
      failed: failView.failed,
      text: `连通失败：${failView.detail}`,
      traceId: failView.traceId,
    });
    assert.equal(failView.failed, true);
    assert.equal(failEl.getAttribute('data-traceId'), 'tid-9');
    assert.match(failEl.textContent, /traceId: tid-9/);

    const okEl = fakeStatus();
    okEl.setAttribute('data-traceId', 'stale');
    const okView = Probe.probeStatusView(null, 'deepseek-chat');
    Probe.renderProbeStatus(okEl, { failed: okView.failed, text: '连通成功', traceId: okView.traceId });
    assert.equal(okView.failed, false);
    assert.equal(okView.textKey, 'paLlmTestOk');
    assert.equal(okEl.getAttribute('data-traceId'), undefined);

    const miss = Probe.probeStatusView({ code: 'incomplete' }, '');
    assert.equal(miss.failed, false);
    assert.equal(miss.textKey, 'paLlmProfileNeedFields');
    assert.equal(miss.traceId, '');
  });
});

describe('Popup 测试连通性按钮', () => {
  it('Probe-UI 按钮紧挨保存智能体配置，文案中英齐备', () => {
    const fields = popupLlmFields();
    const row = fields.match(/<div class="btn-row[^"]*"[\s\S]*?<\/div>/)[0];
    const saveAt = row.indexOf('id="btnSaveLlmConfig"');
    const testAt = row.indexOf('id="btnTestLlmConnectivity"');
    const deleteAt = row.indexOf('id="btnDeleteLlmProfile"');
    assert.ok(saveAt >= 0 && testAt > saveAt && deleteAt > testAt);
    assert.match(row, /data-i18n="paLlmTest"/);
    assert.equal(zh.paLlmTest, '测试连通性');
    assert.equal(en.paLlmTest, 'Test connection');
    assert.ok(zh.paLlmTesting && en.paLlmTesting);
    assert.ok(zh.paLlmTestOk && en.paLlmTestOk);
    assert.ok(zh.paLlmTestFail && en.paLlmTestFail);
  });

  it('Probe-UI 点击走同步门闩并把幂等键交给探测', () => {
    const src = fs.readFileSync(path.join(ROOT, 'popup/popup-llm-config.js'), 'utf8');
    assert.match(src, /btnTestLlmConnectivity/);
    assert.match(src, /createClickGuard/);
    assert.match(src, /probeLlmConnectivity/);
    assert.match(src, /idempotencyKey/);
    assert.match(src, /renderProbeStatus/);
  });
});
