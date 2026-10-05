'use strict';

// OPT-20261005-005: 用本机最近一次 builtin 成功耗时渲染「本机模型」标题，无实测则回退静态文案。
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Mod = require('../lib/page-advisor-builtin-last-run.js');

function fakeStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    data,
    async get(keys) {
      const out = {};
      for (const k of keys) if (k in data) out[k] = data[k];
      return out;
    },
    async set(obj) {
      Object.assign(data, obj);
    },
  };
}

describe('PageAdvisorBuiltinLastRun', () => {
  it('只从 builtin 成功运行提取耗时', () => {
    assert.equal(Mod.extractBuiltinRunMs({ route: 'builtin', status: 'ok', startedAt: 0, endedAt: 126000 }), 126000);
    assert.equal(Mod.extractBuiltinRunMs({ route: 'direct', status: 'ok', startedAt: 0, endedAt: 1000 }), 0);
    assert.equal(Mod.extractBuiltinRunMs({ route: 'builtin', status: 'error', startedAt: 0, endedAt: 1000 }), 0);
    assert.equal(Mod.extractBuiltinRunMs({ route: 'builtin', status: 'ok', startedAt: 500, endedAt: 400 }), 0);
    assert.equal(Mod.extractBuiltinRunMs(null), 0);
  });

  it('记录并读回耗时', async () => {
    const store = fakeStorage();
    const ms = await Mod.recordBuiltinRun(store, { route: 'builtin', status: 'ok', startedAt: 100, endedAt: 45100 });
    assert.equal(ms, 45000);
    assert.equal(store.data[Mod.BUILTIN_LAST_MS_KEY], 45000);
    assert.equal(await Mod.readBuiltinLastMs(store), 45000);

    // 非 builtin 不写入，读数保持。
    await Mod.recordBuiltinRun(store, { route: 'direct', status: 'ok', startedAt: 0, endedAt: 9 });
    assert.equal(await Mod.readBuiltinLastMs(store), 45000);
  });

  it('无实测时回退静态文案，有实测时用占位符', () => {
    const t = (k) => ({
      paLlmRouteBuiltin: '静态提示',
      paLlmRouteBuiltinMeasured: '本机最近约 {sec}s',
    }[k] || k);
    assert.equal(Mod.builtinRouteLabel(t, 0), '静态提示');
    assert.equal(Mod.builtinRouteLabel(t, 126000), '本机最近约 126s');
    assert.equal(Mod.builtinRouteLabel(t, 1400), '本机最近约 1s');
  });

  it('缺 Measured 键时回退静态文案', () => {
    const t = (k) => (k === 'paLlmRouteBuiltin' ? '静态提示' : k);
    assert.equal(Mod.builtinRouteLabel(t, 126000), '静态提示');
  });
});
