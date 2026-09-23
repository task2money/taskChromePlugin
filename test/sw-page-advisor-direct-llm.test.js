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

  it('explicit saas route calls the platform even when a local key is ready', async () => {
    const sandbox = loadSw();
    let created = 0;
    let suggested = 0;
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
      routeMode: 'saas',
    });
    sandbox.PageAdvisorLLM.suggest = async () => { suggested += 1; return []; };
    sandbox.PageAdvisorAPI.createSuggestJob = async () => { created += 1; return { job_id: 'j-saas', status: 'queued' }; };
    sandbox.PageAdvisorAPI.pollSuggestJob = async () => ({ status: 'succeeded', suggestions: [] });
    await sandbox.runPageOptimizationSuggest(1);
    assert.equal(suggested, 0);
    assert.equal(created, 1);
  });

  it('explicit direct route without a key does not fall through to the platform', async () => {
    const payloads = [];
    let created = 0;
    const sandbox = loadSw();
    sandbox.chrome.tabs.sendMessage = async (_tabId, msg) => {
      if (msg.action === 'pageAdvisorResult') payloads.push(msg);
      return { success: true, data: { url: 'https://example.test/page', title: 'T', pageText: 'x' } };
    };
    sandbox.PageAdvisorLlmConfig.loadFromStorage = async () => ({
      apiKey: '',
      baseUrl: '',
      model: '',
      routeMode: 'direct',
    });
    sandbox.PageAdvisorAPI.createSuggestJob = async () => { created += 1; return { job_id: 'no' }; };
    await sandbox.runPageOptimizationSuggest(1);
    assert.equal(created, 0);
    const fail = payloads.find((p) => p.ok === false);
    assert.match(String(fail?.error || ''), /直连|Direct/);
  });
});

/**
 * OPT-20260922-031：已登录用户直接按 Alt+Z（从未打开过 Popup）时，本机还没有系统
 * 目录默认 Skill，直连只能用硬编码 SYSTEM_PROMPT。SW 须补拉一次系统目录并落盘。
 */
describe('sw-page-advisor 直连补拉系统目录默认 Skill（OPT-20260922-031）', () => {
  function boot({ token = 't' } = {}) {
    const payloads = [];
    const sandbox = loadSw({
      Storage: {
        migrateStaleTokenExpiryOnce: async () => {},
        getApiConfig: async () => ({ token, baseUrl: 'https://example.test' }),
        getEndpointMapping: async () => ({}),
        getCredentials: async () => ({}),
        isTokenExpired: async () => false,
        getLastWorkspace: async () => '',
      },
    });
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
      if (msg.action === 'pageAdvisorResult') payloads.push(msg);
      return undefined;
    };
    sandbox.PageAdvisorAPI.createSuggestJob = async () => ({ job_id: 'no' });
    sandbox.PageAdvisorLlmConfig.loadFromStorage = async () => ({
      apiKey: 'sk-local',
      baseUrl: 'https://llm.test',
      model: 'm1',
    });
    return { sandbox, payloads };
  }

  it('本机无 active 且已登录：拉系统目录、落盘并用于直连', async () => {
    let listed = 0;
    let saved = null;
    let seenSkill;
    const { sandbox } = boot();
    sandbox.PageAdvisorPromptSkills.loadFromStorage = async () => ({ skills: [], activeSkillId: '' });
    sandbox.PageAdvisorPromptSkills.saveToStorage = async (store) => { saved = store; };
    sandbox.PageAdvisorAPI.getSystemPromptSkills = async () => {
      listed += 1;
      return { skills: [] };
    };
    sandbox.PageAdvisorLLM.suggest = async (_creds, _page, opts) => {
      seenSkill = opts?.skill;
      return [{ id: 's1', title: 'X' }];
    };

    await sandbox.runPageOptimizationSuggest(1);

    assert.equal(listed, 1, '须拉一次系统目录');
    assert.ok(seenSkill, '直连须带上系统目录默认 Skill');
    const expected = sandbox.PageAdvisorPresetSkills.PRESET_CATEGORY_DEFAULTS.custom;
    assert.equal(seenSkill.id, expected.id);
    assert.equal(seenSkill.body, expected.body);
    assert.ok(saved, '须落盘供后续 Alt+Z 直接复用');
    assert.equal(saved.activeSkillId, expected.id);
    assert.equal(saved.skills.length, 5, '预埋五类系统 Skill');
  });

  it('本机已有 active：不重复拉目录', async () => {
    let listed = 0;
    let seenSkill;
    const { sandbox } = boot();
    sandbox.PageAdvisorPromptSkills.loadFromStorage = async () => ({
      skills: [{ id: 'a', title: 'A11y', body: '优先无障碍' }],
      activeSkillId: 'a',
    });
    sandbox.PageAdvisorAPI.getSystemPromptSkills = async () => { listed += 1; return { skills: [] }; };
    sandbox.PageAdvisorLLM.suggest = async (_creds, _page, opts) => {
      seenSkill = opts?.skill;
      return [{ id: 's1', title: 'X' }];
    };

    await sandbox.runPageOptimizationSuggest(1);

    assert.equal(listed, 0);
    assert.equal(seenSkill.body, '优先无障碍');
  });

  it('未登录：不发系统目录请求', async () => {
    let listed = 0;
    let seenSkill = 'unset';
    const { sandbox } = boot({ token: '' });
    sandbox.PageAdvisorPromptSkills.loadFromStorage = async () => ({ skills: [], activeSkillId: '' });
    sandbox.PageAdvisorAPI.getSystemPromptSkills = async () => { listed += 1; return { skills: [] }; };
    sandbox.PageAdvisorLLM.suggest = async (_creds, _page, opts) => {
      seenSkill = opts?.skill || null;
      return [{ id: 's1', title: 'Guest' }];
    };

    await sandbox.runPageOptimizationSuggest(1);

    assert.equal(listed, 0, '未登录不得请求系统目录');
    assert.equal(seenSkill, null);
  });
  // OPT-20260922-035: 直连不经过 taskPageAdvisor，失败时须把用户看到的 traceId
  // 送到观测口，否则 Loki 按 traceId 检索为空。
  it('直连失败：把用户看到的 traceId 上报到观测口', async () => {
    const { sandbox, payloads } = boot();
    let seen = null;
    sandbox.APIHttp.newRequestTraceId = () => 'sw-mint-trace';
    sandbox.PageAdvisorAPI.reportDirectLlmFailure = async (deps) => {
      seen = deps;
      return true;
    };
    sandbox.PageAdvisorLLM.suggest = async () => {
      const err = new Error('llm http 401: sk-local rejected');
      err.snippet = 'sk-local rejected';
      throw err;
    };

    await sandbox.runPageOptimizationSuggest(1);

    const failed = payloads.find((p) => p.ok === false && p.errorCode === 'PLUGIN_DIRECT_LLM_FAILED');
    assert.ok(failed, JSON.stringify(payloads));
    assert.equal(failed.traceId, 'sw-mint-trace');
    assert.ok(seen, '失败须 best-effort 上报观测口');
    assert.equal(seen.sessionOk, true);
    assert.equal(seen.tenantId, 'ten1');
    assert.equal(seen.traceId, failed.traceId, '展示的 traceId 必须与上报一致');
    assert.equal(seen.model, 'm1');
    assert.equal(seen.err?.snippet, 'sk-local rejected');
    // 上报报文由 lib 构造：键不得出现在出站 JSON 里。
    const payload = sandbox.PageAdvisorAPI.buildClientLlmFailurePayload({
      traceId: seen.traceId,
      errorCode: 'PLUGIN_DIRECT_LLM_FAILED',
      errorMessage: seen.err?.message,
      contentSnippet: seen.err?.snippet,
      model: seen.model,
      apiKey: seen.apiKey,
    });
    assert.equal(JSON.stringify(payload).includes('sk-local'), false);
  });

  it('未登录：直连失败不上报观测口', async () => {
    const { sandbox } = boot({ token: '' });
    let called = 0;
    sandbox.PageAdvisorAPI.reportClientLlmFailure = async () => { called += 1; return true; };
    sandbox.PageAdvisorLLM.suggest = async () => { throw new Error('boom'); };

    await sandbox.runPageOptimizationSuggest(1);

    assert.equal(called, 0, '未登录无 tenant/凭据，不得上报');
  });
});
