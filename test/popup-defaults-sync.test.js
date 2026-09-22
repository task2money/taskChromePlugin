'use strict';

/**
 * OPT-20260914-006: Popup「Alt+E 默认上下文」与浮窗选择双向实时同步。
 *
 * 契约（核心回归点）：onChanged 处理器只读 storage 重渲染，**绝不回写**。
 * 若回写，popup 自身交互写路径会再次触发 onChanged → 死循环。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 模块用全局 tx() 取词（popup.html 先加载 lib/i18n-tx.js）。
require('./helpers/txRuntime.js').installTxRuntime();

const {
  DEFAULTS_STORAGE_KEYS,
  defaultsKeysChanged,
  createDefaultsStorageSync,
} = require('../lib/popup-defaults-sync.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 构造带调用记录的 deps；writes 记录任何写回尝试。 */
function makeDeps(overrides = {}) {
  const calls = { writes: [], loads: [], applied: [], status: [], warns: [] };
  const deps = {
    getLastWorkspace: async () => 'ws-1',
    getLastProjectIds: async () => ['proj-9'],
    getWorkspaces: () => [{ id: 'ws-1' }],
    getCurrentWorkspace: () => '',
    setCurrentWorkspace: (id) => { calls.writes.push(['ws', id]); },
    loadProjects: async (wsId) => { calls.loads.push(wsId); },
    applyProjects: async (ids) => { calls.applied.push(ids); },
    setStatus: (t) => { calls.status.push(t); },
    warn: (e) => { calls.warns.push(e); },
    ...overrides,
  };
  return { deps, calls };
}

describe('defaultsKeysChanged', () => {
  it('只对 lastWorkspaceId / lastProjectIds 返回 true', () => {
    assert.deepEqual(DEFAULTS_STORAGE_KEYS, ['lastWorkspaceId', 'lastProjectIds']);
    assert.equal(defaultsKeysChanged({ lastWorkspaceId: { newValue: 'a' } }), true);
    assert.equal(defaultsKeysChanged({ lastProjectIds: { newValue: [] } }), true);
    assert.equal(defaultsKeysChanged({ token: { newValue: 'x' } }), false);
    assert.equal(defaultsKeysChanged({}), false);
    assert.equal(defaultsKeysChanged(null), false);
    assert.equal(defaultsKeysChanged(undefined), false);
  });

  it('忽略原型链上的同名键（只认自有属性）', () => {
    const changes = Object.create({ lastWorkspaceId: { newValue: 'a' } });
    assert.equal(defaultsKeysChanged(changes), false);
  });
});

describe('createDefaultsStorageSync', () => {
  it('浮窗改了工作空间 → 刷新 select 并重载项目（不写回）', async () => {
    const { deps, calls } = makeDeps({
      getLastWorkspace: async () => 'ws-2',
      getCurrentWorkspace: () => 'ws-1',
    });
    await createDefaultsStorageSync(deps).handle({ lastWorkspaceId: { newValue: 'ws-2' } });
    assert.deepEqual(calls.writes, [['ws', 'ws-2']]);
    assert.deepEqual(calls.loads, ['ws-2']);
    assert.deepEqual(calls.applied, []);
    assert.deepEqual(calls.status, ['已同步浮窗的默认设置']);
  });

  it('浮窗改了项目 → 仅重勾单选（不重载项目、不写回）', async () => {
    const { deps, calls } = makeDeps({
      getLastWorkspace: async () => 'ws-1',
      getCurrentWorkspace: () => 'ws-1',
      getLastProjectIds: async () => ['proj-7'],
    });
    await createDefaultsStorageSync(deps).handle({ lastProjectIds: { newValue: ['proj-7'] } });
    assert.deepEqual(calls.applied, [['proj-7']]);
    assert.deepEqual(calls.loads, []);
    assert.deepEqual(calls.writes, []);
    assert.deepEqual(calls.status, ['已同步浮窗的默认设置']);
  });

  it('工作空间值未变时不重置 select（只处理项目变更）', async () => {
    // 处理器以 storage 为 SSOT 重新读取（不信任 changes.newValue 的部分载荷），
    // 故 mock 的读值须与写入后的真实状态一致。
    const { deps, calls } = makeDeps({
      getLastWorkspace: async () => 'ws-1',
      getCurrentWorkspace: () => 'ws-1',
      getLastProjectIds: async () => [],
    });
    await createDefaultsStorageSync(deps).handle({
      lastWorkspaceId: { newValue: 'ws-1' },
      lastProjectIds: { newValue: [] },
    });
    assert.deepEqual(calls.writes, [], '同值不得触发 UI 重置');
    assert.deepEqual(calls.applied, [[]]);
  });

  it('浮窗清除工作空间 → 清空 select 且不重载项目', async () => {
    const { deps, calls } = makeDeps({
      getLastWorkspace: async () => null,
      getCurrentWorkspace: () => 'ws-1',
    });
    await createDefaultsStorageSync(deps).handle({ lastWorkspaceId: { newValue: null } });
    assert.deepEqual(calls.writes, [['ws', '']]);
    assert.deepEqual(calls.loads, []);
  });

  it('无关键变更不触发任何 IO', async () => {
    const { deps, calls } = makeDeps();
    await createDefaultsStorageSync(deps).handle({ token: { newValue: 'x' } });
    assert.deepEqual(calls, { writes: [], loads: [], applied: [], status: [], warns: [] });
  });

  it('工作空间尚未加载完成时不干预（初次加载自会读取）', async () => {
    const { deps, calls } = makeDeps({ getWorkspaces: () => [] });
    await createDefaultsStorageSync(deps).handle({ lastWorkspaceId: { newValue: 'ws-2' } });
    assert.deepEqual(calls.writes, []);
    assert.deepEqual(calls.status, []);
  });

  it('重入保护：并发 onChanged 只跑一次', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { deps, calls } = makeDeps({
      getLastWorkspace: async () => { await gate; return 'ws-2'; },
      getCurrentWorkspace: () => 'ws-1',
    });
    const sync = createDefaultsStorageSync(deps);
    const first = sync.handle({ lastWorkspaceId: { newValue: 'ws-2' } });
    await sync.handle({ lastWorkspaceId: { newValue: 'ws-3' } });
    release();
    await first;
    assert.deepEqual(calls.writes, [['ws', 'ws-2']], '重入期间第二次变更应被丢弃');
  });

  it('IO 抛错被 warn 吞掉，不冒泡', async () => {
    const { deps, calls } = makeDeps({
      getLastWorkspace: async () => { throw new Error('boom'); },
    });
    await createDefaultsStorageSync(deps).handle({ lastWorkspaceId: { newValue: 'ws-2' } });
    assert.equal(calls.warns.length, 1);
  });

  it('register 只订阅 local 区，返回是否成功', async () => {
    let listener = null;
    const chromeApi = {
      storage: { onChanged: { addListener: (fn) => { listener = fn; } } },
    };
    const { deps, calls } = makeDeps({
      getLastWorkspace: async () => 'ws-2',
      getCurrentWorkspace: () => 'ws-1',
    });
    const sync = createDefaultsStorageSync(deps);
    assert.equal(sync.register(chromeApi), true);
    assert.equal(typeof listener, 'function');
    listener({ lastWorkspaceId: { newValue: 'ws-2' } }, 'session');
    assert.deepEqual(calls.writes, [], 'session 区变更不得处理');
    listener({ lastWorkspaceId: { newValue: 'ws-2' } }, 'local');
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(calls.writes, [['ws', 'ws-2']]);

    assert.equal(createDefaultsStorageSync(deps).register({}), false);
    assert.equal(createDefaultsStorageSync(deps).register(undefined), false);
  });
});

describe('Popup 不再接线默认工作空间 UI', () => {
  const html = read('popup/popup.html');

  it('popup.html 不加载 popup-defaults.js / popup-defaults-sync.js', () => {
    assert.equal(html.includes('popup-defaults.js'), false);
    assert.equal(html.includes('popup-defaults-sync.js'), false);
  });
});
