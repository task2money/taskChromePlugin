'use strict';

/**
 * OPT-20260922-039：PopupPromptSkillCloud.pushWorkspaces 必须用调用方解析好的会话发
 * GET/PUT。否则 PageAdvisorAPI 回落到内部 `API.init` 令牌，init 未覆盖时报
 * PA_SESSION_MISSING——表现为「列表能拉、保存不能推」。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const { installTxInSandbox } = require('./helpers/txRuntime.js');

const presetSrc = fs.readFileSync(path.join(ROOT, 'lib/page-advisor-preset-skills.js'), 'utf8');
const runtimeSrc = fs.readFileSync(path.join(ROOT, 'lib/page-advisor-prompt-skills.js'), 'utf8');
const cloudSrc = fs.readFileSync(path.join(ROOT, 'popup/popup-prompt-skill-cloud.js'), 'utf8');

function boot({ api }) {
  const conflictBox = { style: {} };
  const sandbox = {
    console,
    document: {
      querySelector: (sel) => (sel === '#popupSkillConflict' ? conflictBox : null),
    },
  };
  sandbox.PageAdvisorAPI = api;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  installTxInSandbox(sandbox);
  vm.runInContext(presetSrc, sandbox, { filename: 'lib/page-advisor-preset-skills.js' });
  vm.runInContext(runtimeSrc, sandbox, { filename: 'lib/page-advisor-prompt-skills.js' });
  vm.runInContext(cloudSrc, sandbox, { filename: 'popup/popup-prompt-skill-cloud.js' });
  return sandbox;
}

function makeCtx({ api, session, store, statuses, conflicts }) {
  const ctx = {
    getStore: () => store.value,
    setStore: (next) => { store.value = next; },
    cloudRevisions: {},
    lwwWorkspaceIds: new Set(),
    syncLocalValue: () => 'local',
    refreshWorkspaceRows: async () => {},
    tenantForWorkspace: (wid) => (wid === 'w2' ? 't1' : ''),
    scope: { tenantId: 't1', workspaceId: 'w1' },
    session,
    newIdempotencyKey: () => 'key-1',
    statusText: (m) => statuses.push(m),
    statusCloudFail: () => {},
    setPendingConflict: (body, wid) => conflicts.push({ body, wid }),
  };
  return { ctx, api };
}

function storeWith() {
  return {
    value: {
      skills: [{ id: 's1', title: 'A', body: 'b', syncTarget: 'w2' }],
      activeSkillId: '',
    },
  };
}

describe('PopupPromptSkillCloud.pushWorkspaces 会话透传（OPT-20260922-039）', () => {
  it('GET 与 PUT 都带上 ctx.session，且 PUT 带 Idempotency-Key', async () => {
    const calls = { gets: [], puts: [] };
    const sandbox = boot({
      api: {
        getPromptSkills: async (tid, wid, session) => {
          calls.gets.push({ tid, wid, session });
          return { skills: [], active_skill_id: '', revision: 'r1' };
        },
        putPromptSkills: async (tid, wid, payload, key, session) => {
          calls.puts.push({ tid, wid, key, session, payload });
          return { revision: 'r2', skills: payload.skills, active_skill_id: payload.active_skill_id };
        },
      },
    });
    const session = { baseUrl: 'https://saas.example', token: 'sess-tok' };
    const statuses = [];
    const { ctx } = makeCtx({ session, store: storeWith(), statuses, conflicts: [] });

    const res = await sandbox.PopupPromptSkillCloud.pushWorkspaces(ctx);

    assert.equal(res.ok, true, statuses.join(' / '));
    assert.equal(calls.gets.length, 1);
    assert.equal(calls.gets[0].wid, 'w2');
    assert.equal(calls.gets[0].session?.token, 'sess-tok');
    assert.equal(calls.puts.length, 1);
    assert.equal(calls.puts[0].wid, 'w2');
    assert.equal(calls.puts[0].key, 'key-1');
    assert.equal(calls.puts[0].session?.token, 'sess-tok', 'PUT 须带调用方解析好的会话');
  });

  it('目标工作空间无租户时提示且不发 PUT', async () => {
    const calls = { gets: [], puts: [] };
    const sandbox = boot({
      api: {
        getPromptSkills: async (...a) => { calls.gets.push(a); return { skills: [], revision: 'r1' }; },
        putPromptSkills: async (...a) => { calls.puts.push(a); return {}; },
      },
    });
    const statuses = [];
    const store = storeWith();
    store.value.skills[0].syncTarget = 'w-unknown';
    const { ctx } = makeCtx({ session: null, store, statuses, conflicts: [] });

    const res = await sandbox.PopupPromptSkillCloud.pushWorkspaces(ctx);

    assert.equal(res.ok, false);
    assert.equal(calls.puts.length, 0, '无租户不得 PUT');
    assert.ok(statuses.length >= 1, '须给出提示');
  });

  it('409 冲突挂起面板并返回 conflict，不继续 PUT', async () => {
    const sandbox = boot({
      api: {
        getPromptSkills: async () => ({ skills: [], revision: 'r1' }),
        putPromptSkills: async () => {
          const e = new Error('conflict');
          e.status = 409;
          e.body = { current: { skills: [], active_skill_id: '' } };
          throw e;
        },
      },
    });
    const conflicts = [];
    const { ctx } = makeCtx({ session: null, store: storeWith(), statuses: [], conflicts });

    const res = await sandbox.PopupPromptSkillCloud.pushWorkspaces(ctx);

    assert.deepEqual({ ok: res.ok, conflict: res.conflict }, { ok: false, conflict: true });
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].wid, 'w2');
  });
});
