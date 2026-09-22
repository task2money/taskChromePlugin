'use strict';

const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');

function loadSw(extra = {}) {
  const sandbox = {
    console,
    AbortController,
    setTimeout,
    clearTimeout,
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
    ...extra,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  require('./helpers/txRuntime.js').installTxInSandbox(sandbox);
  for (const rel of [
    'lib/api-http.js',
    'lib/page-advisor-api.js',
    'lib/page-advisor-fail-trace-id.js',
    'lib/page-advisor-llm-config.js',
    'lib/page-advisor-preset-skills.js',
    'lib/page-advisor-prompt-skills.js',
    'lib/page-advisor-locale-prompt.js',
    'lib/page-advisor-llm-client.js',
    'background/sw-page-advisor.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, {
      filename: path.basename(rel),
    });
  }
  return sandbox;
}

describe('sw-page-advisor direct LLM', () => {
  it('skips createSuggestJob when local LLM config is ready', async () => {
    const payloads = [];
    let created = 0;
    const sandbox = loadSw();
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
      if (msg.action === 'pageAdvisorResult') payloads.push(msg);
      return undefined;
    };
    sandbox.PageAdvisorAPI.createSuggestJob = async () => {
      created += 1;
      return { job_id: 'should-not' };
    };
    sandbox.PageAdvisorLlmConfig.loadFromStorage = async () => ({
      apiKey: 'sk-local',
      baseUrl: 'https://llm.test',
      model: 'm1',
    });
    sandbox.PageAdvisorLLM.suggest = async () => ([
      { id: 's1', title: 'Direct', summary: 'from plugin' },
    ]);

    await sandbox.runPageOptimizationSuggest(1);
    assert.equal(created, 0);
    const done = payloads.find((p) => p.ok && p.phase === 'done');
    assert.ok(done, JSON.stringify(payloads));
    assert.equal(done.suggestions[0].title, 'Direct');
    assert.equal(done.featureParamsSource, 'plugin_direct');
  });

  it('passes active prompt skill into PageAdvisorLLM.suggest', async () => {
    let seenSkill;
    const sandbox = loadSw();
    sandbox.chrome.tabs.sendMessage = async (_tabId, msg) => {
      if (msg.action === 'getPageAdvisorContext') {
        return {
          success: true,
          data: {
            url: 'https://example.test/page',
            title: 'T',
            pageText: 'x',
            workspaceId: 'ws1',
            companyId: 'ten1',
          },
        };
      }
      return undefined;
    };
    sandbox.PageAdvisorAPI.createSuggestJob = async () => ({ job_id: 'no' });
    sandbox.PageAdvisorLlmConfig.loadFromStorage = async () => ({
      apiKey: 'sk-local',
      baseUrl: 'https://llm.test',
      model: 'm1',
    });
    sandbox.PageAdvisorPromptSkills.loadFromStorage = async () => ({
      skills: [{ id: 'a', title: 'A11y', body: '优先无障碍' }],
      activeSkillId: 'a',
    });
    sandbox.PageAdvisorLLM.suggest = async (_creds, _page, opts) => {
      seenSkill = opts?.skill;
      return [{ id: 's1', title: 'X' }];
    };
    await sandbox.runPageOptimizationSuggest(1);
    assert.equal(seenSkill.body, '优先无障碍');
  });

  it('T1 guest + direct LLM: no login error, no getWorkspaces, no suggest-jobs', async () => {
    const payloads = [];
    let created = 0;
    let listed = 0;
    const sandbox = loadSw({
      Storage: {
        migrateStaleTokenExpiryOnce: async () => {},
        getApiConfig: async () => ({ token: '', baseUrl: 'https://example.test' }),
        getEndpointMapping: async () => ({}),
        getCredentials: async () => ({}),
        isTokenExpired: async () => false,
        getLastWorkspace: async () => 'ws-stale',
      },
    });
    sandbox.API.getWorkspaces = async () => { listed += 1; return []; };
    sandbox.chrome.tabs.sendMessage = async (_tabId, msg) => {
      if (msg.action === 'getPageAdvisorContext') {
        return { success: true, data: { url: 'https://example.test/page', title: 'T', pageText: 'x', domOutline: [] } };
      }
      if (msg.action === 'pageAdvisorResult') payloads.push(msg);
      return undefined;
    };
    sandbox.PageAdvisorAPI.createSuggestJob = async () => { created += 1; return { job_id: 'no' }; };
    sandbox.PageAdvisorLlmConfig.loadFromStorage = async () => ({ apiKey: 'sk-local', baseUrl: 'https://llm.test', model: 'm1' });
    sandbox.PageAdvisorLLM.suggest = async () => ([{ id: 's1', title: 'Guest' }]);
    await sandbox.runPageOptimizationSuggest(1);
    assert.equal(created, 0);
    assert.equal(listed, 0);
    const done = payloads.find((p) => p.ok && p.phase === 'done');
    assert.ok(done, JSON.stringify(payloads));
    assert.equal(done.featureParamsSource, 'plugin_direct');
  });

  it('T2 guest without LLM config: asks for key or login, no job', async () => {
    const payloads = [];
    let created = 0;
    const sandbox = loadSw({
      Storage: {
        migrateStaleTokenExpiryOnce: async () => {},
        getApiConfig: async () => ({ token: '', baseUrl: 'https://example.test' }),
        getEndpointMapping: async () => ({}),
        getCredentials: async () => ({}),
        isTokenExpired: async () => false,
        getLastWorkspace: async () => '',
      },
    });
    sandbox.chrome.tabs.sendMessage = async (_tabId, msg) => {
      if (msg.action === 'pageAdvisorResult') payloads.push(msg);
      return { success: true, data: {} };
    };
    sandbox.PageAdvisorAPI.createSuggestJob = async () => { created += 1; return { job_id: 'no' }; };
    sandbox.PageAdvisorLlmConfig.loadFromStorage = async () => ({ apiKey: '', baseUrl: '', model: '' });
    await sandbox.runPageOptimizationSuggest(1);
    assert.equal(created, 0);
    const fail = payloads.find((p) => p.ok === false);
    assert.ok(fail, JSON.stringify(payloads));
    assert.match(String(fail.error || ''), /API Key|本机智能体|signed out/i);
    assert.equal(fail.traceId, undefined);
  });

  it('passes AidevpushI18n locale to direct LLM suggest', async () => {
    const sandbox = loadSw();
    sandbox.AidevpushI18n.setLocale('en');
    let seen;
    sandbox.chrome.tabs.sendMessage = async (_tabId, msg) => {
      if (msg.action === 'getPageAdvisorContext') {
        return {
          success: true,
          data: { url: 'https://example.test/page', title: 'T', pageText: 'x', domOutline: [] },
        };
      }
      return undefined;
    };
    sandbox.PageAdvisorLlmConfig.loadFromStorage = async () => ({
      apiKey: 'sk-local',
      baseUrl: 'https://llm.test',
      model: 'm1',
    });
    sandbox.PageAdvisorLLM.suggest = async (_creds, _page, opts) => {
      seen = opts;
      return [{ id: 's1', title: 'Direct' }];
    };
    await sandbox.runPageOptimizationSuggest(1);
    assert.equal(seen.locale, 'en');
  });

  it('cloud createSuggestJob body includes locale', async () => {
    const sandbox = loadSw();
    sandbox.AidevpushI18n.setLocale('en');
    let body;
    sandbox.chrome.tabs.sendMessage = async (_tabId, msg) => {
      if (msg.action === 'getPageAdvisorContext') {
        return {
          success: true,
          data: { url: 'https://example.test/page', title: 'T', pageText: 'x', domOutline: [] },
        };
      }
      return undefined;
    };
    sandbox.PageAdvisorLlmConfig.loadFromStorage = async () => ({ apiKey: '', baseUrl: '', model: '' });
    sandbox.PageAdvisorAPI.createSuggestJob = async (_t, b) => {
      body = b;
      return { job_id: 'j1', status: 'queued' };
    };
    sandbox.PageAdvisorAPI.pollSuggestJob = async () => ({
      status: 'succeeded',
      suggestions: [],
    });
    await sandbox.runPageOptimizationSuggest(1);
    assert.equal(body.locale, 'en');
  });
});
