'use strict';

/**
 * 侧栏生成进度快照：按 tab 存在 `chrome.storage.session`，终态清、过期清、
 * 存储不可用时静默降级（进度续显只是体验，不能反过来影响生成或面板）。
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const Store = require('../lib/agent-suggestions-progress-store.js');

function makeSessionArea() {
  const data = new Map();
  const removed = [];
  return {
    data,
    removed,
    async get(key) {
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(patch) {
      Object.keys(patch || {}).forEach((key) => data.set(key, patch[key]));
    },
    async remove(key) {
      const keys = Array.isArray(key) ? key : [key];
      keys.forEach((k) => {
        data.delete(k);
        removed.push(k);
      });
    },
  };
}

let area = null;

beforeEach(() => {
  area = makeSessionArea();
  global.chrome = { storage: { session: area } };
});

afterEach(() => {
  delete global.chrome;
});

describe('agent-suggestions-progress-store 会话快照', () => {
  it('save → load：按 tab 隔离，百分比取整，runId 与开始时间原样返回', async () => {
    const startedAt = Date.now() - 5000;
    assert.equal(await Store.save(7, { runId: 'run-1', stage: 'generating', percent: 61.6, startedAt }), true);

    const got = await Store.load(7);
    assert.equal(got.tabId, 7);
    assert.equal(got.runId, 'run-1');
    assert.equal(got.stage, 'generating');
    assert.equal(got.percent, 62);
    assert.equal(got.startedAt, startedAt);

    assert.equal(await Store.load(8), null, '别的 tab 看不到这条快照');
  });

  it('save 兼容缺 startedAt：用写入时间兜底，百分比夹在 0–100', async () => {
    await Store.save(7, { runId: 'run-1', stage: 'queued', percent: 999 });
    const got = await Store.load(7);
    assert.equal(got.percent, 100);
    assert.ok(got.startedAt > 0);
  });

  it('超过 TTL 视为后台已中断：load 返回 null 并顺手删掉僵尸快照', async () => {
    await Store.save(7, { runId: 'run-1', stage: 'generating', percent: 60 });
    const later = Date.now() + Store.TTL_MS + 1;
    assert.equal(await Store.load(7, later), null);
    assert.deepEqual(area.removed, [Store.PREFIX + '7'], '过期条目必须清除');
  });

  it('clear 删除指定 tab，不影响其他 tab', async () => {
    await Store.save(7, { runId: 'run-1', stage: 'generating', percent: 50 });
    await Store.save(8, { runId: 'run-2', stage: 'queued', percent: 30 });

    assert.equal(await Store.clear(7), true);
    assert.equal(await Store.load(7), null);
    assert.equal((await Store.load(8)).runId, 'run-2');
  });

  it('缺 runId / 缺 tabId 的快照不写入', async () => {
    assert.equal(await Store.save(7, { stage: 'generating', percent: 50 }), false);
    assert.equal(await Store.save('bad', { runId: 'run-1' }), false);
    assert.equal(area.data.size, 0);
  });

  it('浏览器不支持 storage.session：save/load/clear 静默降级，不抛异常', async () => {
    delete global.chrome;
    assert.equal(await Store.save(7, { runId: 'run-1', stage: 'generating' }), false);
    assert.equal(await Store.load(7), null);
    assert.equal(await Store.clear(7), false);
  });

  it('存储抛错也不冒泡（扩展卸载 / 配额异常）', async () => {
    global.chrome = {
      storage: {
        session: {
          async get() { throw new Error('session gone'); },
          async set() { throw new Error('session gone'); },
          async remove() { throw new Error('session gone'); },
        },
      },
    };
    assert.equal(await Store.save(7, { runId: 'run-1', stage: 'generating' }), false);
    assert.equal(await Store.load(7), null);
    assert.equal(await Store.clear(7), false);
  });
});
