'use strict';

/**
 * 未登录且未配置本机智能体时，「网页优化」生成走匿名每日试用：
 * 提交页面上下文到公开端点，结果以 trial 路由返回（不落优化贴）。
 */

const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');

function loadStack(extra = {}) {
  const calls = { trial: [], context: [] };
  const trial = {
    suggest: async (...args) => {
      calls.trial.push(args);
      return {
        trial_id: 'pt-1',
        suggestions: [{ id: 's1', title: '改标题', summary: '标题太泛' }],
        model: 'deepseek-chat',
        replayed: false,
        quota: { enabled: true, remaining: 2, daily_quota: 3, resets_at: '2026-10-27T16:00:00Z' },
        trace_id: 'trace-trial-1',
      };
    },
    getQuota: async () => ({ enabled: true, remaining: 2 }),
    ...(extra.trialAPI || {}),
  };
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Storage: {
      getApiConfig: async () => ({ token: '', baseUrl: 'https://example.test' }),
      getEndpointMapping: async () => ({}),
      getCredentials: async () => ({}),
      isTokenExpired: async () => false,
    },
    chrome: {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      tabs: { query: async () => [{ id: 7 }], get: async () => ({ id: 7 }) },
    },
    PluginInstallFingerprint: {
      ensurePluginInstallFingerprint: async () => (extra.fingerprint === undefined ? 'pf_test_1' : extra.fingerprint),
    },
    PageAdvisorTrialAPI: trial,
    ClickGuard: { newIdempotencyKey: () => 'ik-trial-1' },
    loadPageAdvisorDirectReady: async () => (
      extra.route || { llmCfg: { apiKey: '', baseUrl: '', model: '' }, directReady: false, route: 'saas' }
    ),
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
        },
      };
    },
    attachSuggestionAnchors: (suggestions) => suggestions.map((s) => ({ ...s, anchored: true })),
    ...(extra.sandbox || {}),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  require('./helpers/txRuntime.js').installTxInSandbox(sandbox);

  for (const rel of [
    'lib/api-http.js',
    'lib/page-advisor-fail-trace-id.js',
    'lib/page-advisor-timing.js',
    'background/sw-page-advisor-timing-run.js',
    'background/sw-page-advisor-generate.js',
    'background/sw-page-advisor-page-trial.js',
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, rel), 'utf8'),
      sandbox,
      { filename: path.basename(rel) },
    );
  }
  return { sandbox, calls };
}

describe('generatePageAdvisorSuggestions 匿名试用路由', () => {
  it('未登录且无本机 Key：提交页面上下文到试用端点，返回 trial 结果与额度', async () => {
    const { sandbox, calls } = loadStack();

    const result = await sandbox.generatePageAdvisorSuggestions(7, {});

    assert.equal(result.ok, true);
    assert.equal(result.route, 'trial');
    assert.equal(result.trial, true);
    assert.equal(result.trialId, 'pt-1');
    assert.equal(result.jobId, '');
    assert.equal(result.quota.remaining, 2);
    assert.equal(result.traceId, 'trace-trial-1');
    assert.equal(result.suggestions[0].anchored, true, '试用结果同样挂页面锚点');

    assert.equal(calls.trial.length, 1);
    const [baseUrl, body, fingerprint, idempotencyKey] = calls.trial[0];
    assert.equal(baseUrl, 'https://example.test');
    assert.equal(fingerprint, 'pf_test_1');
    assert.equal(idempotencyKey, 'ik-trial-1');
    assert.equal(body.fingerprint, 'pf_test_1');
    assert.equal(body.page_url, 'https://shop.test/p?utm=1');
    assert.equal(body.page_title, '商品页');
    assert.equal(body.page_text, '页面正文');
    assert.equal(body.dom_outline.length, 1);
    assert.equal(body.locale, 'zh-CN');
  });

  it('额度用尽：按错误码给本地化文案，保留额度快照与 traceId', async () => {
    const { sandbox } = loadStack({
      trialAPI: {
        suggest: async () => {
          const err = new Error('page_trial_quota_exceeded');
          err.status = 429;
          err.errorCode = 'page_trial_quota_exceeded';
          err.detail = '今日试用次数已用完';
          err.traceId = 'trace-429';
          err.quota = { enabled: true, remaining: 0, daily_quota: 3 };
          throw err;
        },
      },
    });

    const result = await sandbox.generatePageAdvisorSuggestions(7, {});

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'page_trial_quota_exceeded');
    assert.equal(result.error, sandbox.tx('paTrialQuotaExceeded'));
    assert.equal(result.traceId, 'trace-429');
    assert.equal(result.quota.remaining, 0);
  });

  it('试用暂停 / 平台未配置 / 生成失败：各自给本地化文案', async () => {
    const cases = [
      ['page_trial_disabled', 'paTrialDisabled'],
      ['page_trial_platform_unconfigured', 'paTrialPlatformUnconfigured'],
      ['page_trial_generate_failed', 'paTrialGenerateFailed'],
      ['page_trial_ip_quota_exceeded', 'paTrialIPQuotaExceeded'],
      ['page_trial_pool_exhausted', 'paTrialPoolExhausted'],
    ];
    for (const [code, key] of cases) {
      const { sandbox } = loadStack({
        trialAPI: {
          suggest: async () => {
            const err = new Error(code);
            err.errorCode = code;
            throw err;
          },
        },
      });
      const result = await sandbox.generatePageAdvisorSuggestions(7, {});
      assert.equal(result.ok, false, code);
      assert.equal(result.error, sandbox.tx(key), code);
    }
  });

  it('显式选择直连但没配 Key：仍是配置引导，不走试用', async () => {
    const { sandbox, calls } = loadStack({
      route: { llmCfg: {}, directReady: false, route: 'direct' },
    });

    const result = await sandbox.generatePageAdvisorSuggestions(7, {});

    assert.equal(result.ok, false);
    assert.equal(result.error, sandbox.tx('paDirectNeedsConfig'));
    assert.equal(calls.trial.length, 0);
    assert.equal(calls.context.length, 0, '本地就挡住，不必采集页面');
  });

  it('读不到安装指纹：如实报错，不发试用请求', async () => {
    const { sandbox, calls } = loadStack({ fingerprint: '' });

    const result = await sandbox.generatePageAdvisorSuggestions(7, {});

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'PAGE_TRIAL_FINGERPRINT_UNAVAILABLE');
    assert.equal(result.error, sandbox.tx('paTrialFingerprintRequired'));
    assert.equal(calls.trial.length, 0);
  });

  it('试用返回空建议：按失败处理，不把空面板当成功', async () => {
    const { sandbox } = loadStack({
      trialAPI: {
        suggest: async () => ({ trial_id: 'pt-2', suggestions: [], trace_id: 'trace-empty' }),
      },
    });

    const result = await sandbox.generatePageAdvisorSuggestions(7, {});

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'PAGE_TRIAL_EMPTY');
    assert.equal(result.traceId, 'trace-empty');
  });
});
