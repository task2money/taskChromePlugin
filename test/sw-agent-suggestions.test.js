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
    'background/sw-page-advisor-page-trial.js',
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

/** 刷新重试出口的沙箱：只关心 tabs 通道与采集探针。 */
function loadReloadStack({ tabUrl, onReload } = {}) {
  const url = tabUrl || 'https://shop.test/p?utm=1';
  const reloads = [];
  const pings = [];
  // null 复现「扩展重载后的旧页面」：监听器不在，连接直接失败（也是本用例的默认起点）。
  let ping = null;
  const sandbox = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    chrome: {
      tabs: {
        query: async () => [{ id: 7, url }],
        get: async () => ({ id: 7, url, status: 'complete' }),
        reload: async (id) => {
          reloads.push(id);
          // 默认真刷新：新 content script 注入回来，且必然是新实例。
          ping = { ready: true, instanceId: 'inst-new' };
          if (typeof onReload === 'function') onReload();
        },
        sendMessage: async (tabId, msg) => {
          pings.push({ tabId, action: msg && msg.action });
          if (!ping) throw new Error('Could not establish connection. Receiving end does not exist.');
          return { success: true, ...ping };
        },
      },
    },
    isPageAdvisorBlockedUrl: (u) => String(u || '').startsWith('chrome://'),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  require('./helpers/txRuntime.js').installTxInSandbox(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'background/sw-agent-suggestions.js'), 'utf8'),
    sandbox,
    { filename: 'sw-agent-suggestions.js' },
  );
  // 等待预算在单测里缩到毫秒级，别真的等 15 秒。
  sandbox.AGENT_SUGGESTIONS_CONTENT_READY_MS = 120;
  sandbox.AGENT_SUGGESTIONS_PROBE_POLL_MS = 5;
  return { sandbox, reloads, pings, setPing: (v) => { ping = v; } };
}

describe('sw-agent-suggestions 刷新并重试（OPT-20261013-019）', () => {
  it('通道探针：监听器不在即 retryable，且一律用轻量 ping（不消费已框选元素）', async () => {
    const { sandbox, pings } = loadReloadStack();
    const resp = await sandbox.handleProbeAgentSuggestionsChannel();
    assert.equal(resp.success, true);
    assert.equal(resp.state, 'unreachable');
    assert.equal(resp.retryable, true);
    assert.equal(resp.errorCode, 'PAGE_CONTEXT_UNREACHABLE');
    assert.ok(pings.length >= 1);
    // getPageAdvisorContext 会清空用户已框选/拾取的元素，绝不能当探针用。
    assert.ok(pings.every((p) => p.action === 'pingPageAdvisorContext'), JSON.stringify(pings));
  });

  it('通道探针：页面类型本身不支持时不探也不给刷新入口（刷新无用）', async () => {
    const { sandbox, pings } = loadReloadStack({ tabUrl: 'chrome://extensions/' });
    const resp = await sandbox.handleProbeAgentSuggestionsChannel();
    assert.equal(resp.state, 'restricted');
    assert.equal(resp.retryable, false);
    assert.equal(pings.length, 0);
  });

  it('页面类型不支持时点刷新重试：不刷新，直接回不支持', async () => {
    const { sandbox, reloads } = loadReloadStack({ tabUrl: 'chrome://extensions/' });
    const resp = await sandbox.handleReloadActiveTabAndRetry();
    assert.equal(resp.success, false);
    assert.equal(resp.errorCode, 'PAGE_CONTEXT_RESTRICTED_PAGE');
    assert.equal(reloads.length, 0);
  });

  it('刷新后通道恢复：刷新一次并回报成功（由侧栏接着重跑生成）', async () => {
    const { sandbox, reloads } = loadReloadStack();
    const resp = await sandbox.handleReloadActiveTabAndRetry();
    assert.equal(resp.success, true);
    assert.deepEqual(reloads, [7]);
  });

  it('刷新后通道仍不通：仍刷新过一次，但如实回报未恢复', async () => {
    // 刷新没救回来（例如站内脚本又把监听器打断）：探针始终失败。
    const { sandbox, reloads } = loadReloadStack({ onReload: () => {} });
    sandbox.chrome.tabs.sendMessage = async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    };
    const resp = await sandbox.handleReloadActiveTabAndRetry();
    assert.equal(resp.success, false);
    assert.equal(resp.errorCode, 'PAGE_CONTEXT_UNREACHABLE');
    assert.deepEqual(reloads, [7], '用户点了刷新就该真刷新一次');
  });

  it('刷新还没提交文档时探到的旧实例不算恢复（instanceId 未变就继续等）', async () => {
    const stack = loadReloadStack();
    // 刷新前监听器还在；刷新后同一实例仍应答 → 是还没被替换掉的旧脚本，不是恢复。
    stack.setPing({ ready: true, instanceId: 'inst-same' });
    stack.sandbox.chrome.tabs.reload = async (id) => { stack.reloads.push(id); };
    const resp = await stack.sandbox.handleReloadActiveTabAndRetry();
    assert.equal(resp.success, false, '旧实例还在应答就宣告成功，用户点完刷新会再失败一次');
    assert.deepEqual(stack.reloads, [7]);
  });

  it('刷新换成新实例才算恢复', async () => {
    const stack = loadReloadStack();
    stack.setPing({ ready: true, instanceId: 'inst-old' });
    stack.sandbox.chrome.tabs.reload = async (id) => {
      stack.reloads.push(id);
      stack.setPing({ ready: true, instanceId: 'inst-new' });
    };
    const resp = await stack.sandbox.handleReloadActiveTabAndRetry();
    assert.equal(resp.success, true);
  });

  it('没有活动 tab：不刷新、不探测', async () => {
    const { sandbox, reloads, pings } = loadReloadStack();
    sandbox.chrome.tabs.query = async () => [];
    const resp = await sandbox.handleReloadActiveTabAndRetry();
    assert.equal(resp.success, false);
    assert.equal(reloads.length, 0);
    assert.equal(pings.length, 0);
  });
});

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

describe('sw-agent-suggestions 匿名每日试用', () => {
  it('试用结果直接交回侧栏：不解析租户、不落优化贴', async () => {
    const { sandbox, calls } = loadGenerateStack({
      generatePageAdvisorSuggestions: async () => ({
        ok: true,
        route: 'trial',
        trial: true,
        trialId: 'pt-1',
        pageUrl: 'https://shop.test/p',
        pageTitle: '商品页',
        suggestions: [
          { title: '改标题', summary: '首屏标题更具体', detail: '换成含卖点的标题' },
          { title: '加对比', summary: '补对比表' },
        ],
        quota: { enabled: true, remaining: 2, daily_quota: 3, resets_at: '2026-10-27T16:00:00Z' },
        traceId: 'trace-trial-1',
      }),
      resolveTenantIdForSitePending: async () => {
        throw new Error('试用路径不该解析租户');
      },
    });

    const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });

    assert.equal(resp.success, true);
    assert.equal(resp.trial, true);
    assert.equal(resp.trialId, 'pt-1');
    assert.equal(resp.count, 2);
    assert.equal(resp.quota.remaining, 2);
    assert.equal(resp.suggestions[0].title, '改标题');
    assert.equal(resp.traceId, 'trace-trial-1');
    assert.equal(calls.length, 0, '试用不落贴');
  });

  it('getPageTrialQuota：读安装指纹并只读额度接口', async () => {
    const quotaCalls = [];
    const { sandbox } = loadGenerateStack({
      PluginInstallFingerprint: { ensurePluginInstallFingerprint: async () => 'pf_test_9' },
      PageAdvisorTrialAPI: {
        getQuota: async (baseUrl, fingerprint) => {
          quotaCalls.push([baseUrl, fingerprint]);
          return { enabled: true, remaining: 2, daily_quota: 3 };
        },
      },
    });

    const resp = await sandbox.handleGetPageTrialQuota();

    assert.equal(resp.success, true);
    assert.equal(resp.quota.remaining, 2);
    assert.deepEqual(quotaCalls, [['https://example.test', 'pf_test_9']]);
  });

  it('getPageTrialQuota：拿不到指纹时如实报错，不发请求', async () => {
    let called = false;
    const { sandbox } = loadGenerateStack({
      PluginInstallFingerprint: { ensurePluginInstallFingerprint: async () => '' },
      PageAdvisorTrialAPI: {
        getQuota: async () => { called = true; return {}; },
      },
    });

    const resp = await sandbox.handleGetPageTrialQuota();

    assert.equal(resp.success, false);
    assert.equal(resp.errorCode, 'PAGE_TRIAL_FINGERPRINT_UNAVAILABLE');
    assert.equal(called, false);
  });
});
