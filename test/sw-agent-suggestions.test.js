'use strict';

/**
 * ADR-0167：侧边栏「给当前网页生成建议」——
 * 生成走与 Alt+Z 同源的核心，落点由服务端判定（绑定的项目，否则默认项目）。
 */

const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');

function loadGenerateStack(extraSandbox = {}) {
  const calls = [];
  const generateCalls = [];
  const sandbox = {
    console,
    URL,
    chrome: {
      tabs: { query: async () => [{ id: 7, url: 'https://shop.test/p?utm=1#top' }] },
    },
    Storage: {
      getApiConfig: async () => ({ token: 't', baseUrl: 'https://example.test' }),
      isTokenExpired: async () => false,
    },
    ClickGuard: { newIdempotencyKey: () => 'agent-key-1' },
    PageAdvisorPromptSkills: {
      loadFromStorage: async () => ({
        skills: [
          { id: 'sk1', title: '转化优先', tendency: 'conversion', content: '倾向转化' },
          { id: 'sk2', title: '可访问性', tendency: 'a11y', content: '倾向无障碍' },
        ],
        activeSkillId: 'sk2',
      }),
      getActive: (store) => (store.skills || []).find((s) => s.id === store.activeSkillId) || null,
    },
    PageAdvisorAPI: {
      createPendingSuggestion: async (tenantId, body, idempotencyKey) => {
        calls.push({ tenantId, body, idempotencyKey });
        return {
          created: true,
          suggestion_id: 'post-1',
          task_id: 'task-1',
          project_id: 'pj-default',
          project_name: '默认项目',
          workspace_id: 'ws1',
          matched: false,
          matched_by: 'default',
          trace_id: 'trace-1',
        };
      },
    },
    // 生成核心在真实 SW 里是全局函数；这里换成可观测的替身。
    generatePageAdvisorSuggestions: async (tabId, opts) => {
      generateCalls.push({ tabId, opts });
      return {
        ok: true,
        pageUrl: 'https://shop.test/p?utm=1#top',
        pageTitle: '商品页',
        suggestions: [
          { id: 's1', title: '改标题', summary: '首屏标题不够具体', detail: '把标题写具体', dom_id: 'hero' },
          { id: 's2', title: '加对比', summary: '缺少对比', detail: '补一张对比表', target_nid: 'n9' },
        ],
        jobId: 'job-1',
        featureParamsSource: 'plugin_direct',
        traceId: '',
        tenantId: 'ten-page',
        workspaceId: 'ws-page',
      };
    },
    resolveTenantIdForSitePending: async () => ({ ok: true, tenantId: 'ten-last' }),
    ...extraSandbox,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  require('./helpers/txRuntime.js').installTxInSandbox(sandbox);

  for (const rel of [
    'lib/page-advisor-site-pending.js',
    'background/sw-agent-suggestions.js',
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, rel), 'utf8'),
      sandbox,
      { filename: path.basename(rel) },
    );
  }
  sandbox.PageAdvisorSitePending = sandbox.globalThis.PageAdvisorSitePending;
  return { sandbox, calls, generateCalls };
}

/**
 * builtin（本机内置模型）路由的沙箱：生成核心对 builtin 直接拒绝，出口自己驱动 runAltZ。
 * `altZResult` 就是 runAltZ 终态交给 `deps.onResult` 的那份载荷。
 */
function loadBuiltinStack({ altZResult, ...extra } = {}) {
  const altZ = [];
  const result = altZResult === undefined
    ? {
      ok: true,
      phase: 'done',
      pageUrl: 'https://shop.test/p?utm=1',
      suggestions: [
        { id: 'b1', title: '本地模型标题', summary: '本机生成', detail: '细节一' },
        { id: 'b2', title: '第二条', summary: '', detail: '细节二' },
      ],
    }
    : altZResult;
  const stack = loadGenerateStack({
    LanguageModel: { availability: async () => 'available', create: async () => ({}) },
    loadPageAdvisorDirectReady: async () => ({ route: 'builtin', directReady: false, llmCfg: {} }),
    loadDirectLlmSkill: async () => ({ id: 'sys-default', title: '系统默认', tendency: 'system' }),
    askContentPageAdvisorContext: async () => ({ success: true, data: { url: 'https://shop.test/p', title: '商品页' } }),
    notifyContentPageAdvisor: async () => {},
    resolvePageAdvisorLocale: () => 'zh-CN',
    PageAdvisorBuiltinPrompt: {
      runAltZ: async (tabId, deps) => {
        altZ.push({ tabId, deps });
        if (deps && typeof deps.onResult === 'function') deps.onResult(result);
      },
    },
    ...extra,
  });
  return { ...stack, altZ };
}

describe('sw-agent-suggestions builtin 路由（OPT-20261013-011）', () => {
  it('内置模型路由由出口接管：runAltZ 的结果照常落贴，不再返回 AGENT_SUGGESTIONS_BUILTIN_ROUTE', async () => {
    const { sandbox, calls, generateCalls, altZ } = loadBuiltinStack();
    const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });
    assert.equal(resp.success, true);
    assert.equal(resp.count, 2);
    // 生成核心不参与 builtin：接管以后就不该再走到它，也就不会出现那条拒绝码。
    assert.equal(generateCalls.length, 0);
    assert.notEqual(resp.errorCode, 'AGENT_SUGGESTIONS_BUILTIN_ROUTE');
    assert.equal(altZ.length, 1);
    assert.equal(altZ[0].tabId, 7);
    assert.equal(altZ[0].deps.languageModel, sandbox.LanguageModel);
    assert.equal(altZ[0].deps.locale, 'zh-CN');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.title, '本地模型标题');
    assert.equal(calls[0].body.detail, '1. 细节一\n2. 细节二');
  });

  it('落贴网址仍与列表同源（去查询串与片段）', async () => {
    const { sandbox, calls } = loadBuiltinStack();
    await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });
    assert.equal(calls[0].body.page_url, 'https://shop.test/p');
  });

  it('提示词：下拉选中项优先，未选时用与 Alt+Z 同源的默认加载器', async () => {
    const selected = loadBuiltinStack();
    await selected.sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });
    assert.equal((await selected.altZ[0].deps.loadSkill()).id, 'sk1');

    const fallback = loadBuiltinStack();
    await fallback.sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: '' });
    assert.equal((await fallback.altZ[0].deps.loadSkill()).id, 'sys-default');
  });

  it('下载中/待启用的门禁文案原样透传，不发落贴请求', async () => {
    const { sandbox, calls } = loadBuiltinStack({
      altZResult: { ok: false, error: '内置模型下载中 62%', errorCode: 'builtin_downloading' },
    });
    const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });
    assert.equal(resp.success, false);
    assert.equal(resp.error, '内置模型下载中 62%');
    assert.equal(resp.errorCode, 'builtin_downloading');
    assert.equal(calls.length, 0);
  });

  it('拿不到内置模型时也给启用引导（不再退回生成核心的拒绝）', async () => {
    const { sandbox, generateCalls, altZ } = loadBuiltinStack({ LanguageModel: undefined });
    const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });
    assert.equal(altZ.length, 1);
    assert.equal(altZ[0].deps.languageModel, undefined);
    assert.equal(generateCalls.length, 0);
    assert.notEqual(resp.errorCode, 'AGENT_SUGGESTIONS_BUILTIN_ROUTE');
  });

  it('非 builtin 路由仍交回生成核心（接管不越界）', async () => {
    const { sandbox, generateCalls, altZ } = loadBuiltinStack({
      loadPageAdvisorDirectReady: async () => ({ route: 'direct', directReady: true, llmCfg: {} }),
    });
    await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });
    assert.equal(altZ.length, 0);
    assert.equal(generateCalls.length, 1);
  });
});

describe('sw-agent-suggestions 生成并落贴', () => {
  it('选中的提示词进生成核心，倾向随落贴请求上行', async () => {
    const { sandbox, calls, generateCalls } = loadGenerateStack();
    const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });
    assert.equal(resp.success, true);
    assert.equal(generateCalls.length, 1);
    assert.equal(generateCalls[0].tabId, 7);
    assert.equal(generateCalls[0].opts.skill.id, 'sk1');
    assert.equal(generateCalls[0].opts.attachAnchors, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.prompt_tendency, 'conversion');
  });

  it('没选提示词时走默认技能加载器（与 Alt+Z 同源）', async () => {
    const { sandbox, calls, generateCalls } = loadGenerateStack();
    await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: '', promptTendency: '' });
    assert.equal(generateCalls[0].opts.skill, undefined);
    assert.equal(typeof generateCalls[0].opts.skillLoader, 'function');
    assert.equal(calls[0].body.prompt_tendency, '');
  });

  it('落贴网址与列表同源：去掉查询串与片段', async () => {
    const { sandbox, calls } = loadGenerateStack();
    await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });
    assert.equal(calls[0].body.page_url, 'https://shop.test/p');
  });

  it('落点与项目名回报给面板（重放也按成功处理）', async () => {
    const { sandbox } = loadGenerateStack({
      PageAdvisorAPI: {
        createPendingSuggestion: async () => ({
          created: false,
          suggestion_id: 'post-9',
          task_id: 'task-9',
          project_id: 'pj-bound',
          project_name: '绑定项目',
          workspace_id: 'ws-bound',
          matched: true,
          matched_by: 'claim',
        }),
      },
    });
    const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });
    assert.equal(resp.success, true);
    assert.equal(resp.created, false);
    assert.equal(resp.postId, 'post-9');
    assert.equal(resp.projectName, '绑定项目');
    assert.equal(resp.matched, true);
    assert.equal(resp.matchedBy, 'claim');
    assert.equal(resp.workspaceId, 'ws-bound');
  });

  it('生成失败：透传错误与引导链接，不发落贴请求', async () => {
    const { sandbox, calls } = loadGenerateStack({
      generatePageAdvisorSuggestions: async () => ({
        ok: false,
        error: '配额用尽',
        errorCode: 'AUTO_INNOVATE_QUOTA_EXCEEDED',
        traceId: 'trace-x',
        links: [{ label: '买次数', href: 'https://example.test/pricing/' }],
      }),
    });
    const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });
    assert.equal(resp.success, false);
    assert.equal(resp.error, '配额用尽');
    assert.equal(resp.errorCode, 'AUTO_INNOVATE_QUOTA_EXCEEDED');
    assert.equal(resp.traceId, 'trace-x');
    assert.equal(resp.links.length, 1);
    assert.equal(calls.length, 0);
  });

  it('落贴租户：页面上下文优先，缺了退回列表同源解析', async () => {
    const withPage = loadGenerateStack();
    await withPage.sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });
    assert.equal(withPage.calls[0].tenantId, 'ten-page');

    const noPage = loadGenerateStack({
      generatePageAdvisorSuggestions: async () => ({
        ok: true, pageUrl: 'https://shop.test/p', pageTitle: '商品页', suggestions: [],
      }),
    });
    await noPage.sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });
    assert.equal(noPage.calls[0].tenantId, 'ten-last');
  });

  it('解析不到租户（未登录）时不发落贴请求', async () => {
    const { sandbox, calls } = loadGenerateStack({
      generatePageAdvisorSuggestions: async () => ({
        ok: true, pageUrl: 'https://shop.test/p', pageTitle: '商品页', suggestions: [],
      }),
      resolveTenantIdForSitePending: async () => ({ ok: false, reason: 'not_logged_in' }),
    });
    const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });
    assert.equal(resp.success, false);
    assert.match(String(resp.error), /登录/);
    assert.equal(calls.length, 0);
  });

  it('落贴上行的建议行只带可再次定位的字段，标题取第一条、详情多条编号', async () => {
    const { sandbox, calls } = loadGenerateStack();
    await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });
    const body = calls[0].body;
    assert.equal(body.title, '改标题');
    assert.equal(body.summary, '首屏标题不够具体');
    assert.equal(body.detail, '1. 把标题写具体\n2. 补一张对比表');
    assert.equal(body.suggestions.length, 2);
    assert.equal(body.suggestions[0].dom_id, 'hero');
    // 会话期 nid 不上行：换页面就失效，服务端只存能再次定位的锚点。
    assert.equal(body.suggestions[1].target_nid, undefined);
    assert.equal(body.suggestions[1].css_path, '');
  });

  it('落贴带上幂等键（服务端按同一行处理重放）', async () => {
    const { sandbox, calls } = loadGenerateStack();
    await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });
    assert.equal(calls[0].idempotencyKey, 'agent-key-1');
  });
});
