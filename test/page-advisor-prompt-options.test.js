'use strict';

/**
 * 侧栏提示词下拉的服务端选项源（Task 11）。
 *
 * 钉住四件事：
 *  1) 登录态 = 系统目录（只读、目录顺序）+ 工作空间自定义（按 id 去重后追加）；
 *  2) 部分失败保留可用来源并标 partialError，两份都失败才 reject；
 *  3) 下拉选项只带 id/title/tendency/runtime/source/readonly —— 提示词正文不进入输出；
 *  4) 后台消息 loadPageAdvisorPromptOptions 的接线与返回形状。
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PageAdvisorPromptOptions = require('../lib/page-advisor-prompt-options.js');
const realDefaults = require('../lib/page-advisor-defaults.js');

const ROOT = path.join(__dirname, '..');
const BASE = 'https://api.example.test';

const CATALOG = {
  default_skill_id: 'sys-seo',
  skills: [
    {
      id: 'sys-seo',
      title: 'SEO 默认',
      tendency: 'seo',
      runtime: 'rewrite',
      body: 'CATALOG-BODY-SECRET',
      is_default: true,
    },
    {
      id: 'sys-a11y',
      title: '无障碍巡检',
      tendency: 'a11y',
      runtime: 'audit',
      body: 'CATALOG-BODY-2',
    },
  ],
};

const WORKSPACE = {
  active_skill_id: 'ws-conv',
  revision: 'rev-1',
  skills: [
    // 与目录同一个 skill 的工作空间副本：去重后目录条目胜出
    { id: 'sys-seo', title: 'SEO 默认', tendency: 'seo', body: 'CATALOG-BODY-SECRET', readonly: true },
    { id: 'ws-conv', title: '转化专项', tendency: 'conversion', body: 'WORKSPACE-BODY-SECRET' },
    { id: 'ws-perf', title: '性能专项', tendency: 'perf', body: 'WORKSPACE-BODY-2' },
  ],
};

function fakeApi(opts = {}) {
  const calls = { catalog: 0, workspace: 0, workspaceArgs: [] };
  const catalog = opts.catalog === undefined ? CATALOG : opts.catalog;
  const workspace = opts.workspace === undefined ? WORKSPACE : opts.workspace;
  return {
    calls,
    async getSystemPromptSkills() {
      calls.catalog += 1;
      if (opts.catalogError) throw opts.catalogError;
      // 服务端目录带正文；本模块必须只投影下拉需要的元数据。
      return catalog;
    },
    async getPromptSkills(tenantId, workspaceId) {
      calls.workspace += 1;
      calls.workspaceArgs.push([tenantId, workspaceId]);
      if (opts.workspaceError) throw opts.workspaceError;
      return workspace;
    },
  };
}

function fakeTrialApi(opts = {}) {
  const calls = { count: 0, args: [] };
  return {
    calls,
    async getPromptSkills(...args) {
      calls.count += 1;
      calls.args.push(args);
      if (opts.error) throw opts.error;
      return opts.payload === undefined ? CATALOG : opts.payload;
    },
  };
}

function errorWith(message, extra = {}) {
  const err = new Error(message);
  return Object.assign(err, extra);
}

beforeEach(() => {
  PageAdvisorPromptOptions.resetCache();
});

describe('PageAdvisorPromptOptions.load — 登录态合并', () => {
  it('目录在前（只读）、工作空间自定义去重后追加，默认取 active_skill_id', async () => {
    const api = fakeApi();
    const result = await PageAdvisorPromptOptions.load({
      loggedIn: true,
      baseUrl: BASE,
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      api,
      trialApi: null,
    });

    assert.deepEqual(result.skills.map((s) => s.id), ['sys-seo', 'sys-a11y', 'ws-conv', 'ws-perf']);
    assert.deepEqual(result.skills.map((s) => s.source), ['catalog', 'catalog', 'workspace', 'workspace']);
    assert.deepEqual(result.skills.map((s) => s.readonly), [true, true, false, false]);
    assert.equal(result.skills[0].title, 'SEO 默认');
    assert.equal(result.skills[0].runtime, 'rewrite');
    assert.equal(result.defaultSkillId, 'ws-conv');
    assert.equal(result.defaultTitle, '转化专项');
    assert.equal(result.partialError, false);
    assert.deepEqual(api.calls.workspaceArgs, [['tenant-1', 'ws-1']]);
    assert.equal(api.calls.catalog, 1);

    // 正文不进入下拉选项，也不出现在任何输出字段里。
    for (const skill of result.skills) assert.equal('body' in skill, false);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  });

  it('工作空间 active_skill_id 不在列表内时回落到目录 default_skill_id', async () => {
    const api = fakeApi({
      workspace: { ...WORKSPACE, active_skill_id: 'ghost-skill' },
    });
    const result = await PageAdvisorPromptOptions.load({
      loggedIn: true,
      baseUrl: BASE,
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      api,
      trialApi: null,
    });

    assert.equal(result.defaultSkillId, 'sys-seo');
    assert.equal(result.defaultTitle, 'SEO 默认');
  });
});

describe('PageAdvisorPromptOptions.load — 未登录公开目录', () => {
  it('只调公开目录端点，默认取响应里的 default_skill_id', async () => {
    const trialApi = fakeTrialApi();
    const result = await PageAdvisorPromptOptions.load({
      loggedIn: false,
      baseUrl: BASE,
      tenantId: 'tenant-should-be-ignored',
      workspaceId: 'ws-should-be-ignored',
      api: null,
      trialApi,
    });

    assert.deepEqual(trialApi.calls.args, [[BASE]]);
    assert.deepEqual(result.skills.map((s) => s.id), ['sys-seo', 'sys-a11y']);
    assert.ok(result.skills.every((s) => s.source === 'catalog' && s.readonly === true));
    assert.equal(result.defaultSkillId, 'sys-seo');
    assert.equal(result.defaultTitle, 'SEO 默认');
    assert.equal(result.partialError, false);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  });

  it('公开目录失败直接 reject（单来源没有 partial 可留）', async () => {
    const boom = errorWith('catalog unavailable', { errorCode: 'prompt_catalog_unavailable', status: 503 });
    const trialApi = fakeTrialApi({ error: boom });
    await assert.rejects(
      () => PageAdvisorPromptOptions.load({
        loggedIn: false,
        baseUrl: BASE,
        tenantId: '',
        workspaceId: '',
        api: null,
        trialApi,
      }),
      (err) => {
        assert.equal(err, boom);
        return true;
      },
    );
  });
});

describe('PageAdvisorPromptOptions.load — 部分失败', () => {
  it('目录失败：保留工作空间来源并标 partialError', async () => {
    const api = fakeApi({
      catalogError: errorWith('catalog down', { errorCode: 'PROMPT_CATALOG_UNAVAILABLE', status: 503 }),
    });
    const result = await PageAdvisorPromptOptions.load({
      loggedIn: true,
      baseUrl: BASE,
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      api,
      trialApi: null,
    });

    assert.equal(result.partialError, true);
    assert.deepEqual(result.skills.map((s) => s.id), ['sys-seo', 'ws-conv', 'ws-perf']);
    // 工作空间里的系统 skill 副本保留服务端的只读标记，不冒充自定义。
    assert.equal(result.skills[0].readonly, true);
    assert.deepEqual(result.skills.map((s) => s.source), ['workspace', 'workspace', 'workspace']);
    assert.equal(result.defaultSkillId, 'ws-conv');
    assert.equal(result.defaultTitle, '转化专项');
  });

  it('工作空间失败：保留目录来源并标 partialError', async () => {
    const api = fakeApi({
      workspaceError: errorWith('workspace down', { errorCode: 'PA_SESSION_MISSING' }),
    });
    const result = await PageAdvisorPromptOptions.load({
      loggedIn: true,
      baseUrl: BASE,
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      api,
      trialApi: null,
    });

    assert.equal(result.partialError, true);
    assert.deepEqual(result.skills.map((s) => s.id), ['sys-seo', 'sys-a11y']);
    assert.equal(result.defaultSkillId, 'sys-seo');
    assert.equal(result.defaultTitle, 'SEO 默认');
  });

  it('两份都失败才 reject，并带首个错误码与两份失败明细', async () => {
    const catalogError = errorWith('catalog down', {
      errorCode: 'PROMPT_CATALOG_UNAVAILABLE', status: 503, traceId: 'tid-catalog',
    });
    const workspaceError = errorWith('workspace down', { errorCode: 'PA_SESSION_MISSING' });
    const api = fakeApi({ catalogError, workspaceError });

    await assert.rejects(
      () => PageAdvisorPromptOptions.load({
        loggedIn: true,
        baseUrl: BASE,
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        api,
        trialApi: null,
      }),
      (err) => {
        assert.equal(err.errorCode, 'PROMPT_CATALOG_UNAVAILABLE');
        assert.equal(err.status, 503);
        assert.equal(err.traceId, 'tid-catalog');
        assert.equal(err.errors.length, 2);
        assert.deepEqual(err.errors.map((e) => e.source), ['catalog', 'workspace']);
        assert.equal(err.errors[0].error, catalogError);
        assert.equal(err.errors[1].error, workspaceError);
        return true;
      },
    );
  });

  it('工作空间 id 缺失时按工作空间来源失败处理，目录仍返回 partial', async () => {
    const api = fakeApi();
    const result = await PageAdvisorPromptOptions.load({
      loggedIn: true,
      baseUrl: BASE,
      tenantId: '',
      workspaceId: '',
      api,
      trialApi: null,
    });

    assert.equal(result.partialError, true);
    assert.deepEqual(result.skills.map((s) => s.id), ['sys-seo', 'sys-a11y']);
    assert.equal(result.defaultSkillId, 'sys-seo');
  });
});

describe('PageAdvisorPromptOptions.load — 内存缓存', () => {
  it('同身份重复 load 只请求一次（目录与工作空间各一次）', async () => {
    const api = fakeApi();
    const input = {
      loggedIn: true, baseUrl: BASE, tenantId: 'tenant-1', workspaceId: 'ws-1', api, trialApi: null,
    };
    const first = await PageAdvisorPromptOptions.load(input);
    const second = await PageAdvisorPromptOptions.load(input);

    assert.equal(api.calls.catalog, 1);
    assert.equal(api.calls.workspace, 1);
    assert.deepEqual(second.skills.map((s) => s.id), first.skills.map((s) => s.id));
  });

  it('身份（工作空间）变化时丢弃旧缓存，互不串味', async () => {
    const calls = { catalog: 0, workspace: 0, workspaceArgs: [] };
    const api = {
      async getSystemPromptSkills() {
        calls.catalog += 1;
        return CATALOG;
      },
      async getPromptSkills(tenantId, workspaceId) {
        calls.workspace += 1;
        calls.workspaceArgs.push([tenantId, workspaceId]);
        return {
          active_skill_id: workspaceId === 'ws-2' ? 'ws-only-2' : 'ws-conv',
          skills: workspaceId === 'ws-2'
            ? [{ id: 'ws-only-2', title: '二空间专属', tendency: 'custom' }]
            : WORKSPACE.skills,
        };
      },
    };

    const first = await PageAdvisorPromptOptions.load({
      loggedIn: true, baseUrl: BASE, tenantId: 'tenant-1', workspaceId: 'ws-1', api, trialApi: null,
    });
    const second = await PageAdvisorPromptOptions.load({
      loggedIn: true, baseUrl: BASE, tenantId: 'tenant-1', workspaceId: 'ws-2', api, trialApi: null,
    });

    assert.equal(calls.workspace, 2);
    assert.ok(first.skills.some((s) => s.id === 'ws-conv'));
    assert.equal(second.skills.some((s) => s.id === 'ws-conv'), false);
    assert.deepEqual(second.skills.map((s) => s.id), ['sys-seo', 'sys-a11y', 'ws-only-2']);
    assert.equal(second.defaultSkillId, 'ws-only-2');

    // 回到 ws-1：缓存已按身份换掉，必须重新拉取。
    await PageAdvisorPromptOptions.load({
      loggedIn: true, baseUrl: BASE, tenantId: 'tenant-1', workspaceId: 'ws-1', api, trialApi: null,
    });
    assert.equal(calls.workspace, 3);
  });

  it('partial 结果不缓存，下次仍会重试缺失的来源', async () => {
    let failWorkspace = true;
    const calls = { catalog: 0, workspace: 0 };
    const api = {
      async getSystemPromptSkills() {
        calls.catalog += 1;
        return CATALOG;
      },
      async getPromptSkills() {
        calls.workspace += 1;
        if (failWorkspace) {
          throw errorWith('workspace down', { errorCode: 'PA_SESSION_MISSING' });
        }
        return WORKSPACE;
      },
    };
    const input = {
      loggedIn: true, baseUrl: BASE, tenantId: 'tenant-1', workspaceId: 'ws-1', api, trialApi: null,
    };

    const partial = await PageAdvisorPromptOptions.load(input);
    assert.equal(partial.partialError, true);
    assert.equal(calls.catalog, 1);
    assert.equal(calls.workspace, 1);

    failWorkspace = false;
    const complete = await PageAdvisorPromptOptions.load(input);
    assert.equal(complete.partialError, false);
    assert.equal(calls.catalog, 2);
    assert.equal(calls.workspace, 2);
    assert.ok(complete.skills.some((s) => s.id === 'ws-conv'));
  });

  it('resetCache 后重新拉取', async () => {
    const api = fakeApi();
    const input = {
      loggedIn: true, baseUrl: BASE, tenantId: 'tenant-1', workspaceId: 'ws-1', api, trialApi: null,
    };
    await PageAdvisorPromptOptions.load(input);
    PageAdvisorPromptOptions.resetCache();
    await PageAdvisorPromptOptions.load(input);
    assert.equal(api.calls.catalog, 2);
    assert.equal(api.calls.workspace, 2);
  });

  it('返回的 skills 是副本，调用方改写不会污染缓存', async () => {
    const api = fakeApi();
    const input = {
      loggedIn: true, baseUrl: BASE, tenantId: 'tenant-1', workspaceId: 'ws-1', api, trialApi: null,
    };
    const first = await PageAdvisorPromptOptions.load(input);
    first.skills[0].title = '被改写';
    first.skills.length = 0;
    const second = await PageAdvisorPromptOptions.load(input);
    assert.equal(second.skills[0].title, 'SEO 默认');
    assert.equal(second.skills.length, 4);
  });
});

describe('PageAdvisorPromptOptions — 记住的下拉选择', () => {
  let prevStorage;

  beforeEach(() => {
    prevStorage = globalThis.Storage;
  });

  afterEach(() => {
    if (prevStorage === undefined) {
      delete globalThis.Storage;
    } else {
      globalThis.Storage = prevStorage;
    }
  });

  it('loadSelectedId 读 pageAdvisorSelectedPromptId', async () => {
    const readKeys = [];
    globalThis.Storage = {
      async get(keys) {
        readKeys.push(keys);
        return { pageAdvisorSelectedPromptId: 'ws-conv' };
      },
      async set() {},
    };

    assert.equal(await PageAdvisorPromptOptions.loadSelectedId(), 'ws-conv');
    assert.deepEqual(readKeys, [['pageAdvisorSelectedPromptId']]);
  });

  it('saveSelectedId 写 pageAdvisorSelectedPromptId 并去掉首尾空白', async () => {
    const writes = [];
    globalThis.Storage = {
      async get() { return {}; },
      async set(items) { writes.push(items); },
    };

    await PageAdvisorPromptOptions.saveSelectedId('  ws-perf  ');
    assert.deepEqual(writes, [{ pageAdvisorSelectedPromptId: 'ws-perf' }]);
  });

  it('未读到值时返回空串', async () => {
    globalThis.Storage = {
      async get() { return {}; },
      async set() {},
    };
    assert.equal(await PageAdvisorPromptOptions.loadSelectedId(), '');
  });
});

describe('后台消息 loadPageAdvisorPromptOptions', () => {
  function loadHandlerSandbox(opts = {}) {
    const calls = { load: [], init: [], workspaces: 0 };
    const sandbox = {
      console,
      tx: (key) => key,
      Storage: {
        getApiConfig: async () => opts.cfg || { baseUrl: BASE, token: '' },
        isTokenExpired: async () => Boolean(opts.expired),
        getEndpointMapping: async () => ({ owner: 'owner-1' }),
        getCredentials: async () => ({ userId: 'user-1' }),
        getLastWorkspace: async () => opts.lastWorkspaceId || null,
        getLastWorkspaceManual: async () => (opts.lastWorkspaceManual === undefined ? null : opts.lastWorkspaceManual),
      },
      API: {
        init: (...args) => { calls.init.push(args); },
        setOwner: () => {},
        getWorkspaces: async () => {
          calls.workspaces += 1;
          return opts.workspaces || [];
        },
      },
      PageAdvisorDefaults: realDefaults,
      PageAdvisorPromptOptions: {
        load: async (input) => {
          calls.load.push(input);
          if (opts.loadError) throw opts.loadError;
          return {
            skills: [{ id: 'sys-seo', title: 'SEO 默认', source: 'catalog', readonly: true }],
            defaultSkillId: 'sys-seo',
            defaultTitle: 'SEO 默认',
            partialError: Boolean(opts.partialError),
          };
        },
      },
      PageAdvisorAPI: { marker: 'page-advisor-api' },
      PageAdvisorTrialAPI: { marker: 'trial-api' },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, 'background/sw-page-advisor-prompts.js'), 'utf8'),
      sandbox,
      { filename: 'sw-page-advisor-prompts.js' },
    );
    return { sandbox, calls };
  }

  it('登录态：解析租户/工作空间后带 api 调用 load，返回下拉需要的字段', async () => {
    const { sandbox, calls } = loadHandlerSandbox({
      cfg: { baseUrl: BASE, token: 'token-1' },
      workspaces: [{ id: 'ws-1', company_id: 'tenant-1', is_default: true }],
    });

    const res = await sandbox.handleLoadPageAdvisorPromptOptions();

    assert.equal(res.ok, true);
    assert.equal(res.defaultSkillId, 'sys-seo');
    assert.equal(res.defaultTitle, 'SEO 默认');
    assert.equal(res.partialError, false);
    assert.deepEqual(res.skills.map((s) => s.id), ['sys-seo']);
    assert.equal(calls.init.length, 1);
    assert.equal(calls.load.length, 1);
    const input = calls.load[0];
    assert.equal(input.loggedIn, true);
    assert.equal(input.baseUrl, BASE);
    assert.equal(input.tenantId, 'tenant-1');
    assert.equal(input.workspaceId, 'ws-1');
    assert.equal(input.api, sandbox.PageAdvisorAPI);
    assert.equal(input.trialApi, sandbox.PageAdvisorTrialAPI);
  });

  it('未登录：不解析工作空间，交给 load 走公开目录', async () => {
    const { sandbox, calls } = loadHandlerSandbox({
      cfg: { baseUrl: BASE, token: '' },
      workspaces: [{ id: 'ws-1', company_id: 'tenant-1', is_default: true }],
    });

    const res = await sandbox.handleLoadPageAdvisorPromptOptions();

    assert.equal(res.ok, true);
    assert.equal(calls.workspaces, 0);
    assert.equal(calls.load[0].loggedIn, false);
    assert.equal(calls.load[0].tenantId, '');
    assert.equal(calls.load[0].workspaceId, '');
    assert.equal(calls.load[0].trialApi, sandbox.PageAdvisorTrialAPI);
  });

  it('token 过期按未登录处理', async () => {
    const { sandbox, calls } = loadHandlerSandbox({
      cfg: { baseUrl: BASE, token: 'expired-token' },
      expired: true,
    });

    await sandbox.handleLoadPageAdvisorPromptOptions();
    assert.equal(calls.load[0].loggedIn, false);
  });

  it('load 抛错时返回 ok:false 并带错误码与 traceId', async () => {
    const boom = errorWith('catalog down', {
      errorCode: 'prompt_catalog_unavailable', traceId: 'tid-9', status: 503,
    });
    const { sandbox } = loadHandlerSandbox({
      cfg: { baseUrl: BASE, token: 'token-1' },
      workspaces: [{ id: 'ws-1', company_id: 'tenant-1', is_default: true }],
      loadError: boom,
    });

    const res = await sandbox.handleLoadPageAdvisorPromptOptions();
    assert.equal(res.ok, false);
    assert.equal(res.error, 'catalog down');
    assert.equal(res.errorCode, 'prompt_catalog_unavailable');
    assert.equal(res.traceId, 'tid-9');
  });

  it('接线：importScripts 与消息分发都指向新模块', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'background/service-worker.js'), 'utf8');
    assert.ok(sw.includes("'../lib/page-advisor-prompt-options.js'"));
    assert.ok(sw.includes("'./sw-page-advisor-prompts.js'"));

    const messages = fs.readFileSync(path.join(ROOT, 'background/sw-messages-task.js'), 'utf8');
    assert.match(
      messages,
      /case 'loadPageAdvisorPromptOptions':\s*\n\s*return handleLoadPageAdvisorPromptOptions\(\);/,
    );
  });
});
