'use strict';

/**
 * 生成核心的提示词接线（Task 13）：
 * 两条服务端路径（匿名试用 / 登录平台）的请求体都带 `prompt_skill_id`，
 * 不再带旧的 `agent_source` / `sku_id` / `own_model` / `own_provider`；
 * 服务端拒绝未知提示词（`invalid_prompt_skill`）时用空 id 重试一次，
 * 并在返回结果上标记 `promptFallback`。提示词正文始终由服务端按 id 解析。
 */

const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const LEGACY_BODY_KEYS = ['agent_source', 'sku_id', 'own_model', 'own_provider'];

function assertNoLegacyBodyKeys(body) {
  for (const key of LEGACY_BODY_KEYS) {
    assert.equal(body[key], undefined, `${key} 不应再上行`);
  }
}

function loadStack(extra = {}) {
  const calls = { trial: [], create: [], poll: [], context: [] };
  const warns = [];
  const trialSuggest = extra.trialSuggest || (async () => ({
    trial_id: 'pt-1',
    suggestions: [{ id: 's1', title: '改标题', summary: '标题太泛' }],
    trace_id: 'trace-trial',
  }));
  const createSuggestJob = extra.createSuggestJob
    || (async () => ({ job_id: 'job-1', trace_id: 'trace-create' }));
  const pollSuggestJob = extra.pollSuggestJob
    || (async () => ({ status: 'succeeded', suggestions: [{ id: 's1', title: '改标题' }] }));

  const sandbox = {
    console: {
      log() {},
      info() {},
      warn: (...args) => warns.push(args),
      error() {},
    },
    URL,
    Storage: {
      getApiConfig: async () => (extra.loggedIn
        ? { token: 't', baseUrl: 'https://example.test' }
        : { token: '', baseUrl: 'https://example.test' }),
      getEndpointMapping: async () => ({}),
      getCredentials: async () => ({}),
      isTokenExpired: async () => false,
    },
    API: { init() {}, setOwner() {}, getWorkspaces: async () => [] },
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } },
    PluginInstallFingerprint: { ensurePluginInstallFingerprint: async () => 'pf_test_1' },
    PageAdvisorTrialAPI: {
      suggest: async (...args) => {
        calls.trial.push(args);
        return trialSuggest(...args);
      },
    },
    PageAdvisorAPI: {
      createSuggestJob: async (...args) => {
        calls.create.push(args);
        return createSuggestJob(...args);
      },
      pollSuggestJob: async (...args) => {
        calls.poll.push(args);
        return pollSuggestJob(...args);
      },
    },
    PageAdvisorPromptOptions: extra.promptOptions || { loadSelectedId: async () => '' },
    ClickGuard: { newIdempotencyKey: () => 'idem-1' },
    loadPageAdvisorDirectReady: async () => (extra.route || {
      llmCfg: { apiKey: '', baseUrl: '', model: '' },
      directReady: false,
      route: 'saas',
    }),
    resolvePageAdvisorLocale: () => 'zh-CN',
    askContentPageAdvisorContext: async (tabId) => {
      calls.context.push(tabId);
      return {
        success: true,
        data: {
          url: 'https://shop.test/p?utm=1',
          title: '商品页',
          pageText: '页面正文',
          domOutline: [{ tag: 'h1', text: '标题' }],
          workspaceId: 'ws1',
          companyId: 'ten1',
        },
      };
    },
    capturePageAdvisorScreenshotHook: async () => '',
    attachSuggestionAnchors: (rows) => rows,
    ...(extra.sandbox || {}),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  require('./helpers/txRuntime.js').installTxInSandbox(sandbox);

  for (const rel of [
    'background/sw-page-advisor-generate.js',
    'background/sw-page-advisor-page-trial.js',
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, rel), 'utf8'),
      sandbox,
      { filename: path.basename(rel) },
    );
  }
  return { sandbox, calls, warns };
}

describe('generatePageAdvisorSuggestions 提示词上送', () => {
  it('trial body carries prompt_skill_id and never agent_source/own_*', async () => {
    const { sandbox, calls } = loadStack({
      promptOptions: { loadSelectedId: async () => 'stored-id' },
    });

    const result = await sandbox.generatePageAdvisorSuggestions(7, { promptSkillId: 'ws-conv' });

    assert.equal(result.ok, true);
    assert.equal(result.promptSkillId, 'ws-conv', '显式 id 优先于记住的选择');
    assert.equal(result.promptFallback, undefined);
    assert.equal(calls.trial.length, 1);
    const body = calls.trial[0][1];
    assert.equal(body.prompt_skill_id, 'ws-conv');
    assert.equal(body.fingerprint, 'pf_test_1');
    assert.equal(body.page_url, 'https://shop.test/p?utm=1');
    assert.equal(body.locale, 'zh-CN');
    assertNoLegacyBodyKeys(body);
  });

  it('没有显式 promptSkillId 时用侧栏记住的选择', async () => {
    const { sandbox, calls } = loadStack({
      promptOptions: { loadSelectedId: async () => '  stored-id  ' },
    });

    const result = await sandbox.generatePageAdvisorSuggestions(7, {});

    assert.equal(result.promptSkillId, 'stored-id');
    assert.equal(calls.trial[0][1].prompt_skill_id, 'stored-id');
  });

  it('platform body carries prompt_skill_id and no agent_source/sku_id/own_*', async () => {
    const { sandbox, calls } = loadStack({ loggedIn: true });

    const result = await sandbox.generatePageAdvisorSuggestions(7, { promptSkillId: 'ws-conv' });

    assert.equal(result.ok, true);
    assert.equal(result.promptSkillId, 'ws-conv');
    assert.equal(calls.create.length, 1);
    const body = calls.create[0][1];
    assert.equal(body.prompt_skill_id, 'ws-conv');
    assert.equal(body.workspace_id, 'ws1');
    assert.equal(body.screenshot_url, '');
    assert.equal(body.locale, 'zh-CN');
    assert.equal(body.page_title, '商品页');
    assertNoLegacyBodyKeys(body);
  });
});

describe('generatePageAdvisorSuggestions 无效提示词回退', () => {
  it('invalid_prompt_skill retries once with empty id and flags promptFallback', async () => {
    let attempts = 0;
    const { sandbox, calls, warns } = loadStack({
      trialSuggest: async () => {
        attempts += 1;
        if (attempts === 1) {
          const err = new Error('unknown prompt skill');
          err.status = 400;
          err.errorCode = 'invalid_prompt_skill';
          throw err;
        }
        return { trial_id: 'pt-2', suggestions: [{ title: '默认提示词结果' }] };
      },
    });

    const result = await sandbox.generatePageAdvisorSuggestions(7, { promptSkillId: 'bad-id' });

    assert.equal(result.ok, true);
    assert.equal(result.promptFallback, true);
    assert.deepEqual(
      calls.trial.map((call) => call[1].prompt_skill_id),
      ['bad-id', ''],
      '重试恰好一次，且用空 id 走服务端默认',
    );
    assert.ok(
      warns.some((entry) => String(entry[0]).includes('page_advisor_prompt_invalid_fallback')),
      JSON.stringify(warns),
    );
  });

  it('platform 的 invalid_prompt_skill 同样只回退一次', async () => {
    const bodies = [];
    let attempts = 0;
    const { sandbox } = loadStack({
      loggedIn: true,
      createSuggestJob: async (_tenantId, body) => {
        bodies.push(body);
        attempts += 1;
        if (attempts === 1) {
          const err = new Error('unknown prompt skill');
          err.status = 400;
          err.errorCode = 'invalid_prompt_skill';
          throw err;
        }
        return { job_id: 'job-2', trace_id: 'trace-create-2' };
      },
    });

    const result = await sandbox.generatePageAdvisorSuggestions(7, { promptSkillId: 'bad-id' });

    assert.equal(result.ok, true);
    assert.equal(result.promptFallback, true);
    assert.deepEqual(bodies.map((body) => body.prompt_skill_id), ['bad-id', '']);
  });

  it('其他错误不重试，空 id 的 invalid_prompt_skill 也不重试', async () => {
    let attempts = 0;
    const { sandbox } = loadStack({
      trialSuggest: async () => {
        attempts += 1;
        const err = new Error('boom');
        err.status = 500;
        err.errorCode = 'page_trial_generate_failed';
        throw err;
      },
    });
    const failed = await sandbox.generatePageAdvisorSuggestions(7, { promptSkillId: 'ws-conv' });
    assert.equal(failed.ok, false);
    assert.equal(failed.promptFallback, undefined);
    assert.equal(attempts, 1);

    let emptyAttempts = 0;
    const empty = loadStack({
      trialSuggest: async () => {
        emptyAttempts += 1;
        const err = new Error('unknown prompt skill');
        err.status = 400;
        err.errorCode = 'invalid_prompt_skill';
        throw err;
      },
    });
    const res = await empty.sandbox.generatePageAdvisorSuggestions(7, { promptSkillId: '' });
    assert.equal(res.ok, false);
    assert.equal(res.promptFallback, undefined, '没发过 id 就没有「回退」可言');
    assert.equal(emptyAttempts, 1);
  });
});
