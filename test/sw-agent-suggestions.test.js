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

/** 让出一次宏任务：进度快照的写入/删除是后台异步动作，不阻塞生成结果。 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function loadGenerateStack(extraSandbox = {}) {
  const calls = [];
  const generateCalls = [];
  // 侧栏进度广播：后台只负责把 runId + 阶段原样发出去。
  const progress = [];
  // chrome.storage.session 替身：重开侧栏续显进度用的会话快照。
  const session = { data: new Map(), removed: [] };
  const sessionArea = {
    async get(key) {
      return session.data.has(key) ? { [key]: session.data.get(key) } : {};
    },
    async set(patch) {
      Object.keys(patch || {}).forEach((key) => session.data.set(key, patch[key]));
    },
    async remove(key) {
      const keys = Array.isArray(key) ? key : [key];
      keys.forEach((k) => {
        session.data.delete(k);
        session.removed.push(k);
      });
    },
  };
  const sandbox = {
    console,
    URL,
    chrome: {
      tabs: { query: async () => [{ id: 7, url: 'https://shop.test/p?utm=1#top' }] },
      storage: { session: sessionArea },
      runtime: {
        sendMessage(message) {
          progress.push(message);
          return Promise.resolve({ ok: true });
        },
      },
    },
    Storage: {
      getApiConfig: async () => ({ token: 't', baseUrl: 'https://example.test' }),
      isTokenExpired: async () => false,
    },
    ClickGuard: { newIdempotencyKey: () => 'agent-key-1' },
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
        featureParamsSource: 'plugin_saas',
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
    'lib/agent-suggestions-progress-store.js',
    'background/sw-page-advisor-page-trial.js',
    'background/sw-agent-suggestions-progress.js',
    'background/sw-agent-suggestions-diagnostics.js',
    'background/sw-agent-suggestions.js',
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, rel), 'utf8'),
      sandbox,
      { filename: path.basename(rel) },
    );
  }
  sandbox.PageAdvisorSitePending = sandbox.globalThis.PageAdvisorSitePending;
  return { sandbox, calls, generateCalls, progress, session };
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
  for (const rel of [
    'background/sw-agent-suggestions-channel.js',
    'background/sw-agent-suggestions.js',
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, rel), 'utf8'),
      sandbox,
      { filename: path.basename(rel) },
    );
  }
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

describe('sw-agent-suggestions 生成并落贴', () => {
  it('选中的提示词 id 进生成核心（只传 id，不读本地 skill 正文），倾向随落贴请求上行', async () => {
    const { sandbox, calls, generateCalls } = loadGenerateStack();
    const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({
      promptSkillId: 'ws-conv',
      promptTendency: 'conversion',
    });
    assert.equal(resp.success, true);
    assert.equal(generateCalls.length, 1);
    assert.equal(generateCalls[0].tabId, 7);
    assert.equal(generateCalls[0].opts.promptSkillId, 'ws-conv');
    assert.equal(generateCalls[0].opts.skill, undefined);
    assert.equal(generateCalls[0].opts.skillLoader, undefined);
    assert.equal(generateCalls[0].opts.attachAnchors, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.prompt_tendency, 'conversion');
  });

  it('带 progressRunId：生成核心的阶段进度原样广播，收尾广播 done', async () => {
    const { sandbox, generateCalls, progress } = loadGenerateStack({
      generatePageAdvisorSuggestions: async (tabId, opts) => {
        generateCalls.push({ tabId, opts });
        opts.onProgress({ stage: 'capture', percent: 8 });
        opts.onProgress({ stage: 'generating', percent: 55 });
        return {
          ok: true,
          pageUrl: 'https://shop.test/p',
          pageTitle: '商品页',
          suggestions: [{ title: '改标题' }],
          tenantId: 'ten-page',
        };
      },
    });
    const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({
      promptSkillId: '',
      progressRunId: ' run-1 ',
    });

    assert.equal(resp.success, true);
    assert.equal(generateCalls.length, 1);
    assert.equal(typeof generateCalls[0].opts.onProgress, 'function', '带 runId 才注入进度钩子');
    assert.deepEqual(
      progress.map((m) => m.runId + ':' + m.progress.stage + ':' + m.progress.percent),
      ['run-1:capture:8', 'run-1:generating:55', 'run-1:done:100'],
    );
  });

  it('生成中的进度按 tab 写会话快照；成功后清掉，侧栏重开不再续到已完成任务', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { sandbox, session } = loadGenerateStack({
      generatePageAdvisorSuggestions: async (tabId, opts) => {
        opts.onProgress({ stage: 'generating', percent: 55 });
        await gate;
        return {
          ok: true,
          pageUrl: 'https://shop.test/p',
          pageTitle: '商品页',
          suggestions: [{ title: '改标题' }],
          tenantId: 'ten-page',
        };
      },
    });

    const pending = sandbox.handleGenerateAgentSuggestionsForActiveTab({ progressRunId: 'run-9' });
    await tick();

    const mid = await sandbox.handleGetAgentSuggestionsProgress();
    assert.equal(mid.success, true);
    assert.equal(mid.progress.runId, 'run-9');
    assert.equal(mid.progress.stage, 'generating');
    assert.equal(mid.progress.percent, 55, '重开侧栏能续上后台正在跑的进度');
    assert.equal(mid.progress.tabId, 7);

    release();
    await pending;
    await tick();

    const finished = await sandbox.handleGetAgentSuggestionsProgress();
    assert.equal(finished.progress, null, '终态后不再续显');
    assert.equal(session.data.size, 0, '终态快照必须删除');
  });

  it('clearAgentSuggestionsProgress 删除当前 tab 的快照（侧栏本地收起时调用）', async () => {
    const { sandbox, session } = loadGenerateStack();
    await sandbox.AgentSuggestionsProgressStore.save(7, {
      runId: 'run-clear', stage: 'generating', percent: 50,
    });
    assert.equal(session.data.size, 1);

    const resp = await sandbox.handleClearAgentSuggestionsProgress();
    assert.equal(resp.success, true);
    assert.equal(session.data.size, 0);
    assert.equal((await sandbox.handleGetAgentSuggestionsProgress()).progress, null);
  });

  it('没有 activity tab 时查进度：如实回失败，不编造快照', async () => {
    const { sandbox } = loadGenerateStack({
      chrome: {
        tabs: { query: async () => [] },
        storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
        runtime: { sendMessage: async () => ({ ok: true }) },
      },
    });
    const resp = await sandbox.handleGetAgentSuggestionsProgress();
    assert.equal(resp.success, false);
    assert.equal(resp.reason, 'no_active_tab');
  });

  it('没有 progressRunId：不广播，也不往生成核心塞进度钩子', async () => {
    const { sandbox, generateCalls, progress } = loadGenerateStack();
    await sandbox.handleGenerateAgentSuggestionsForActiveTab({});

    assert.equal(progress.length, 0);
    assert.equal(generateCalls[0].opts.onProgress, undefined, '无 runId 的调用（如 Alt+Z）保持原样');
  });

  it('生成失败广播 failed 终态，侧栏据此收起进度条', async () => {
    const { sandbox, progress } = loadGenerateStack({
      generatePageAdvisorSuggestions: async () => ({ ok: false, error: '配额用尽' }),
    });
    await sandbox.handleGenerateAgentSuggestionsForActiveTab({ progressRunId: 'run-2' });

    // 事件对象来自 vm 上下文，跨 realm 的 deepEqual 会因原型不同而误报，逐字段断言。
    const last = progress[progress.length - 1];
    assert.equal(last.action, 'agentSuggestionsProgress');
    assert.equal(last.runId, 'run-2');
    assert.equal(last.progress.stage, 'failed');
    assert.equal(last.progress.percent, 100);
  });

  it('没选提示词时用侧栏记住的选择，不再加载本地 skill', async () => {
    const { sandbox, calls, generateCalls } = loadGenerateStack({
      PageAdvisorPromptOptions: { loadSelectedId: async () => ' stored-id ' },
    });
    await sandbox.handleGenerateAgentSuggestionsForActiveTab({ promptSkillId: '', promptTendency: '' });
    assert.equal(generateCalls[0].opts.promptSkillId, 'stored-id');
    assert.equal(generateCalls[0].opts.skill, undefined);
    assert.equal(generateCalls[0].opts.skillLoader, undefined);
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

  it('pending suggestion posts prompt_skill_id and suggest_job_id from the generation', async () => {
    const { sandbox, calls, generateCalls } = loadGenerateStack({
      generatePageAdvisorSuggestions: async (tabId, opts) => {
        generateCalls.push({ tabId, opts });
        return {
          ok: true,
          pageUrl: 'https://shop.test/p?utm=1#top',
          pageTitle: '商品页',
          suggestions: [{ id: 's1', title: '改标题', summary: '首屏标题不够具体' }],
          jobId: 'job-42',
          promptSkillId: 'ws-conv',
          featureParamsSource: 'plugin_saas',
          traceId: 'trace-1',
          tenantId: 'ten-page',
          workspaceId: 'ws-page',
        };
      },
    });

    const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({
      promptSkillId: 'ws-conv',
      promptTendency: 'conversion',
    });

    assert.equal(resp.success, true);
    assert.equal(generateCalls[0].opts.promptSkillId, 'ws-conv');
    assert.equal(calls[0].body.prompt_skill_id, 'ws-conv');
    assert.equal(calls[0].body.suggest_job_id, 'job-42');
    assert.equal(calls[0].body.agent_source, undefined);
    assert.equal(calls[0].body.sku_id, undefined);
    assert.equal(calls[0].body.own_model, undefined);
    assert.equal(calls[0].body.own_provider, undefined);
  });

  it('没有生成 job 时发送空 suggest_job_id（服务端 trim）', async () => {
    const { sandbox, calls } = loadGenerateStack({
      generatePageAdvisorSuggestions: async () => ({
        ok: true,
        pageUrl: 'https://shop.test/p',
        pageTitle: '商品页',
        suggestions: [{ title: '改标题' }],
        promptSkillId: '',
        jobId: '',
        featureParamsSource: 'plugin_saas',
        tenantId: 'ten-page',
      }),
    });

    await sandbox.handleGenerateAgentSuggestionsForActiveTab({ promptSkillId: 'ws-conv' });

    assert.equal(calls[0].body.prompt_skill_id, '');
    assert.equal(Object.prototype.hasOwnProperty.call(calls[0].body, 'suggest_job_id'), true);
    assert.equal(calls[0].body.suggest_job_id, '');
  });
});

describe('sw-agent-suggestions 匿名每日试用', () => {
  it('试用结果直接交回侧栏：不解析租户、不落会员帖', async () => {
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
    assert.equal(calls.length, 0, '试用不走会员建帖接口');
  });

  it('试用已落匿名帖：把 postId 交给侧栏选中，令牌不出现', async () => {
    const { sandbox, calls } = loadGenerateStack({
      generatePageAdvisorSuggestions: async () => ({
        ok: true,
        route: 'trial',
        trial: true,
        trialId: 'pt-2',
        suggestions: [{ title: '改标题', summary: '首屏标题更具体' }],
        anonymousPost: { postId: 'post-9', pageUrl: 'https://shop.test/p', expiresAt: '2026-11-04T09:00:00Z' },
        traceId: 'trace-trial-2',
      }),
    });

    const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });

    assert.equal(resp.success, true);
    assert.equal(resp.trial, true);
    assert.equal(resp.postId, 'post-9');
    assert.equal(resp.anonymous, true);
    assert.equal(resp.count, 1);
    assert.equal(resp.anonymousPost, undefined, '只回 id，不回令牌');
    assert.equal(calls.length, 0);
  });

  it('试用落贴失败：仍给建议，并带 postError 供侧栏降级', async () => {
    const { sandbox } = loadGenerateStack({
      generatePageAdvisorSuggestions: async () => ({
        ok: true,
        route: 'trial',
        trial: true,
        suggestions: [{ title: '改标题' }],
        anonymousPost: null,
        postError: 'unavailable',
      }),
    });

    const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({ skillId: 'sk1' });

    assert.equal(resp.success, true);
    assert.equal(resp.postId, undefined);
    assert.equal(resp.postError, 'unavailable');
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

  it('生成成功后记录本次整次耗时，供下次估算总时长', async () => {
    const recorded = [];
    const { sandbox } = loadGenerateStack({
      AgentSuggestionsEta: { record: async (ms) => { recorded.push(ms); return true; } },
    });
    const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({});

    assert.equal(resp.success, true);
    assert.equal(recorded.length, 1, '成功收尾记一条样本');
    assert.ok(Number(recorded[0]) >= 0, '记录整次耗时（毫秒）');
  });

  it('匿名试用成功也记录耗时', async () => {
    const recorded = [];
    const { sandbox } = loadGenerateStack({
      AgentSuggestionsEta: { record: async (ms) => { recorded.push(ms); return true; } },
      generatePageAdvisorSuggestions: async () => ({
        ok: true,
        trial: true,
        route: 'trial',
        trialId: 'pt-1',
        suggestions: [{ title: '改标题' }],
        quota: { enabled: true, remaining: 2, daily_quota: 3 },
      }),
    });
    const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({});

    assert.equal(resp.success, true);
    assert.equal(recorded.length, 1, '试用路径出结果也算一次成功耗时');
  });

  it('生成失败 / 未登录 / 落贴失败都不记样本', async () => {
    const setups = [
      { generatePageAdvisorSuggestions: async () => ({ ok: false, error: '配额用尽' }) },
      {
        generatePageAdvisorSuggestions: async () => ({
          ok: true, pageUrl: 'https://shop.test/p', pageTitle: '商品页', suggestions: [],
        }),
        resolveTenantIdForSitePending: async () => ({ ok: false, reason: 'not_logged_in' }),
      },
      { PageAdvisorAPI: { createPendingSuggestion: async () => { throw new Error('落贴失败'); } } },
    ];
    for (const setup of setups) {
      const recorded = [];
      const { sandbox } = loadGenerateStack(Object.assign({
        AgentSuggestionsEta: { record: async (ms) => { recorded.push(ms); return true; } },
      }, setup));
      const resp = await sandbox.handleGenerateAgentSuggestionsForActiveTab({});
      assert.equal(resp.success, false);
      assert.equal(recorded.length, 0, '失败路径不污染耗时样本');
    }
  });
});
