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
    ClickGuard: { newIdempotencyKey: () => 'idem-key' },
    ...extraSandbox,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const rel of [
    'lib/api-http.js',
    'lib/page-advisor-api.js',
    'lib/page-advisor-fail-trace-id.js',
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
});
