'use strict';

/**
 * sw-page-advisor.js 行为：失败 job 须经 lib 解析非空 traceId（约束 24），不测源码正则。
 */

const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');

function loadSwPageAdvisorStack(extraSandbox = {}) {
  const sandbox = {
    console,
    chrome: {
      tabs: {
        query: async () => [{ id: 1 }],
        sendMessage: async () => ({ success: true, data: {} }),
      },
      commands: { getAll: async () => [], update: async () => {} },
    },
    Storage: {
      migrateStaleTokenExpiryOnce: async () => {},
      getApiConfig: async () => ({ token: 't', baseUrl: 'https://example.test' }),
      getEndpointMapping: async () => ({}),
      getCredentials: async () => ({}),
      isTokenExpired: async () => false,
      getLastWorkspace: async () => '',
    },
    API: {
      init: () => {},
      setOwner: () => {},
      getWorkspaces: async () => [],
      getBaseUrl: () => 'https://example.test',
      getToken: () => 't',
    },
    PageAdvisorDefaults: {
      resolvePageAdvisorWorkspace: () => ({ workspaceId: 'ws1', companyId: 'ten1', source: 'test' }),
    },
    // 未保存调用方式时产品默认直连；本套测的是平台失败 job 的 traceId，须显式走 saas。
    PageAdvisorLlmConfig: {
      loadFromStorage: async () => ({ apiKey: '', baseUrl: '', model: '', routeMode: 'saas' }),
      resolveRoute: (cfg) => (cfg && cfg.routeMode === 'direct' ? 'direct' : 'saas'),
      isDirectLlmReady: () => false,
    },
    ClickGuard: { newIdempotencyKey: () => 'idem-key' },
    ...extraSandbox,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // 与真实 SW 同构：i18n 先于业务脚本装载（OPT-20260919-009 第 7 批）。
  require('./helpers/txRuntime.js').installTxInSandbox(sandbox);

  for (const rel of [
    'lib/api-http.js',
    'lib/page-advisor-api.js',
    'lib/page-advisor-fail-trace-id.js',
    'lib/page-advisor-timing.js',
    'background/sw-page-advisor-timing-run.js',
    'background/sw-page-advisor.js',
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, rel), 'utf8'),
      sandbox,
      { filename: path.basename(rel) },
    );
  }
  return sandbox;
}

function jobWithResolvedTrace(resolvedId, body = {}) {
  const job = { status: 'failed', error_message: 'Insufficient Balance', ...body };
  Object.defineProperty(job, '_resolvedTraceId', {
    value: resolvedId,
    enumerable: false,
    configurable: true,
  });
  return job;
}

describe('sw-page-advisor failed job traceId (lib wiring)', () => {
  it('notifyContentPageAdvisor receives traceId from PageAdvisorFailTraceId on failed poll', async () => {
    const payloads = [];
    const sandbox = loadSwPageAdvisorStack();

    sandbox.chrome.tabs.sendMessage = async (_tabId, msg) => {
      if (msg.action === 'getPageAdvisorContext') {
        return {
          success: true,
          data: {
            url: 'https://example.test/page',
            title: 'T',
            pageText: 'x',
            domOutline: [],
            workspaceId: 'ws1',
            companyId: 'ten1',
          },
        };
      }
      if (msg.action === 'pageAdvisorResult') {
        payloads.push(msg);
      }
      return undefined;
    };

    const failedJob = jobWithResolvedTrace('llm-402-trace', { error_code: 'PAYMENT_REQUIRED' });
    sandbox.PageAdvisorAPI.createSuggestJob = async () => ({
      job_id: 'job-1',
      trace_id: 'create-trace',
    });
    sandbox.PageAdvisorAPI.pollSuggestJob = async () => failedJob;

    await sandbox.runPageOptimizationSuggest(1);

    const failPayload = payloads.find(
      (p) => p.ok === false && String(p.error || '').includes('Insufficient Balance'),
    );
    assert.ok(failPayload, `expected failed job notification, got: ${JSON.stringify(payloads)}`);
    assert.equal(failPayload.traceId, 'create-trace');
    assert.equal(failPayload.errorCode, 'PAYMENT_REQUIRED');
  });

  it('failed job uses job _resolvedTraceId when create seed is empty', async () => {
    const payloads = [];
    const sandbox = loadSwPageAdvisorStack();
    sandbox.APIHttp.newRequestTraceId = () => '';

    sandbox.chrome.tabs.sendMessage = async (_tabId, msg) => {
      if (msg.action === 'getPageAdvisorContext') {
        return {
          success: true,
          data: {
            url: 'https://example.test/page',
            title: 'T',
            pageText: 'x',
            domOutline: [],
            workspaceId: 'ws1',
            companyId: 'ten1',
          },
        };
      }
      if (msg.action === 'pageAdvisorResult') {
        payloads.push(msg);
      }
      return undefined;
    };

    const failedJob = jobWithResolvedTrace('resolved-fail-trace');
    sandbox.PageAdvisorAPI.createSuggestJob = async () => ({ job_id: 'job-2' });
    sandbox.PageAdvisorAPI.pollSuggestJob = async () => failedJob;

    await sandbox.runPageOptimizationSuggest(1);

    const failPayload = payloads.find((p) => p.ok === false && p.traceId);
    assert.ok(failPayload, `expected fail payload, got: ${JSON.stringify(payloads)}`);
    assert.equal(failPayload.traceId, 'resolved-fail-trace');
  });

  it('采集超时后通知失败而不是永久 loading', async () => {
    const payloads = [];
    const sandbox = loadSwPageAdvisorStack({
      withTimeout: (p, _ms, _label) => new Promise((_, reject) => {
        setTimeout(() => reject(new Error('getPageAdvisorContext timeout')), 40);
      }),
    });
    sandbox.chrome.tabs.sendMessage = async (_tabId, msg) => {
      if (msg.action === 'getPageAdvisorContext') {
        return new Promise(() => {});
      }
      if (msg.action === 'pageAdvisorResult') {
        payloads.push(msg);
      }
      return undefined;
    };
    await sandbox.runPageOptimizationSuggest(1);
    const fail = payloads.find((p) => p && p.ok === false);
    assert.ok(fail, `expected timeout failure, got: ${JSON.stringify(payloads)}`);
  });

  it('failed job waterfall keeps planned render as skipped (never ran)', async () => {
    const wf = [];
    const sandbox = loadSwPageAdvisorStack();
    sandbox.chrome.runtime = {
      sendMessage: (msg) => { wf.push(msg); },
    };
    sandbox.chrome.tabs.sendMessage = async (_tabId, msg) => {
      if (msg.action === 'getPageAdvisorContext') {
        return {
          success: true,
          data: {
            url: 'https://example.test/page',
            title: 'T',
            pageText: 'x',
            domOutline: [],
            workspaceId: 'ws1',
            companyId: 'ten1',
          },
        };
      }
      return undefined;
    };
    sandbox.PageAdvisorAPI.createSuggestJob = async () => ({ job_id: 'job-1', trace_id: 'create-trace' });
    sandbox.PageAdvisorAPI.pollSuggestJob = async () => jobWithResolvedTrace('llm-402-trace', {
      error_code: 'PAYMENT_REQUIRED',
    });
    await sandbox.runPageOptimizationSuggest(1);
    const last = [...wf].reverse().find((m) => m && m.action === 'pageAdvisorWaterfall');
    assert.ok(last && last.run);
    assert.equal(last.run.status, 'error');
    const render = (last.run.spans || []).find((s) => s.id === 'render');
    assert.ok(render, 'planned render row is visible from the start');
    assert.equal(render.status, 'skipped');
  });

  it('successful saas poll splits platform poll using llm_forward', async () => {
    const wf = [];
    const sandbox = loadSwPageAdvisorStack();
    sandbox.chrome.runtime = { sendMessage: (msg) => { wf.push(msg); } };
    sandbox.chrome.tabs.sendMessage = async (_tabId, msg) => {
      if (msg.action === 'getPageAdvisorContext') {
        return {
          success: true,
          data: {
            url: 'https://example.test/page',
            title: 'T',
            pageText: 'x',
            domOutline: [],
            workspaceId: 'ws1',
            companyId: 'ten1',
          },
        };
      }
      return undefined;
    };
    sandbox.PageAdvisorAPI.createSuggestJob = async () => ({ job_id: 'job-fwd', trace_id: 't' });
    sandbox.PageAdvisorAPI.pollSuggestJob = async () => ({
      status: 'succeeded',
      suggestions: [],
      llm_forward: {
        send_ms: 12,
        wait_ms: 23000,
        recv_ms: 40,
        request_bytes: 8421,
        response_bytes: 3102,
      },
    });
    await sandbox.runPageOptimizationSuggest(1);
    const last = [...wf].reverse().find((m) => m && m.action === 'pageAdvisorWaterfall');
    assert.ok(last && last.run);
    const ids = (last.run.spans || []).map((s) => s.id);
    assert.equal(ids.includes('saas_poll'), false);
    assert.ok(ids.includes('saas_fwd_send'));
    assert.ok(ids.includes('saas_fwd_wait'));
    assert.ok(ids.includes('saas_fwd_recv'));
    const wait = last.run.spans.find((s) => s.id === 'saas_fwd_wait');
    assert.equal(wait.labelMs, 23000);
  });

  it('successful job copies the Alt+X element label onto suggestions', async () => {
    require('../lib/element-picker.js');
    require('../lib/page-advisor-anchor.js');
    const payloads = [];
    const sandbox = loadSwPageAdvisorStack();
    sandbox.attachSuggestionAnchors = global.attachSuggestionAnchors;
    const outline = [{
      nid: 'n1',
      tag: 'button',
      id: 'go',
      label: 'button#go.primary.taskplugin-el-highlight',
      css_path: 'button#go',
      visible_text: '去结算',
      html_snippet: '<button id="go">去结算</button>',
      text: '去结算',
      parent_nid: '',
    }];
    sandbox.chrome.tabs.sendMessage = async (_tabId, msg) => {
      if (msg.action === 'getPageAdvisorContext') {
        return {
          success: true,
          data: {
            url: 'https://example.test/page',
            title: 'T',
            pageText: 'x',
            domOutline: outline,
            workspaceId: 'ws1',
            companyId: 'ten1',
          },
        };
      }
      if (msg.action === 'pageAdvisorResult') payloads.push(msg);
      return undefined;
    };
    sandbox.PageAdvisorAPI.createSuggestJob = async () => ({ job_id: 'job-ok', trace_id: 't' });
    sandbox.PageAdvisorAPI.pollSuggestJob = async () => ({
      status: 'succeeded',
      suggestions: [{
        id: 's1',
        title: '对比度',
        summary: '短',
        detail: '提高对比度',
        target_nid: 'n1',
      }],
    });
    await sandbox.runPageOptimizationSuggest(1);
    const done = payloads.find((p) => p && p.ok && p.phase === 'done');
    assert.ok(done, `expected done payload, got: ${JSON.stringify(payloads)}`);
    assert.equal(done.suggestions[0].label, outline[0].label);
    const { formatSuggestionsBlock } = require('../lib/page-advisor-fill.js');
    const block = formatSuggestionsBlock(done.suggestions, 'https://example.test/page');
    assert.match(block, /- \*\*元素\*\*: `button#go\.primary\.taskplugin-el-highlight`/);
    assert.doesNotMatch(block, /- \*\*元素\*\*: `element`/);
  });

  it('region command marks alt-shift-z until consumed', () => {
    const sandbox = loadSwPageAdvisorStack();
    sandbox.markPageAdvisorSuggestCommand('alt-shift-z');
    assert.equal(sandbox.consumePageAdvisorSuggestCommand(), 'alt-shift-z');
    assert.equal(sandbox.consumePageAdvisorSuggestCommand(), 'alt-z');
  });
});
