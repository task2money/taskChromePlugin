'use strict';

/**
 * 「给当前网页生成建议」的耗时自学习：
 * - 用最近成功生成的整次耗时估算下一次的总时长（不再写死 60s）；
 * - 中位数抗单次抖动/偶发慢任务；
 * - 样本最多 9 条，异常短的失败样本不得进入统计；
 * - 存储不可用时一律回退默认值，绝不影响生成主流程。
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const Eta = require('../lib/agent-suggestions-eta.js');

function createStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      const out = {};
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key];
      }
      return out;
    },
    async set(patch) {
      Object.assign(data, patch);
    },
  };
}

afterEach(() => {
  delete globalThis.Storage;
});

describe('agent-suggestions-eta 估时模型', () => {
  it('没有历史样本时回退默认总时长', () => {
    assert.equal(Eta.DEFAULT_TOTAL_MS, 60000);
    assert.equal(Eta.estimateMs([]), 60000);
    assert.equal(Eta.estimateMs(null), 60000);
    assert.equal(Eta.estimateMs(['nope', null, undefined, -5, 0]), 60000, '无效样本不参与估算');
  });

  it('单次样本即按实际耗时估算', () => {
    assert.equal(Eta.estimateMs([21000]), 21000);
  });

  it('多次样本取中位数，抗偶发慢任务', () => {
    assert.equal(Eta.estimateMs([20000, 22000, 24000]), 22000);
    assert.equal(Eta.estimateMs([20000, 24000]), 22000, '偶数条取中间两条均值');
    assert.equal(Eta.estimateMs([20000, 21000, 22000, 105000]), 21500, '一次超慢任务不把估值拉走');
  });

  it('过滤异常短样本，估算夹在合理区间', () => {
    assert.equal(Eta.estimateMs([500, 20000]), 20000, '失败早退类短样本不参与');
    assert.equal(Eta.estimateMs([1, 2, 3]), 60000, '全部样本都不可用时回退默认值');
    assert.equal(Eta.estimateMs([999999]), 60000, '异常长样本被丢弃，回退默认值');
    assert.equal(Eta.estimateMs([3000]), Eta.MIN_ESTIMATE_MS);
    assert.equal(Eta.MIN_SAMPLE_MS, 1000);
  });

  it('record 追加样本并落盘，返回 true', async () => {
    const storage = createStorage();
    globalThis.Storage = storage;
    assert.equal(await Eta.record(21000), true);
    assert.deepEqual(storage.data[Eta.STORAGE_KEY], [21000]);
    assert.equal(await Eta.record(23000), true);
    assert.deepEqual(storage.data[Eta.STORAGE_KEY], [21000, 23000]);
  });

  it('record 只保留最近 MAX_SAMPLES 条', async () => {
    const samples = Array.from({ length: Eta.MAX_SAMPLES }, (_, i) => 20000 + i * 1000);
    const storage = createStorage({ [Eta.STORAGE_KEY]: samples });
    globalThis.Storage = storage;
    assert.equal(await Eta.record(30000), true);
    const saved = storage.data[Eta.STORAGE_KEY];
    assert.equal(saved.length, Eta.MAX_SAMPLES);
    assert.equal(saved[saved.length - 1], 30000);
    assert.equal(saved[0], samples[1], '最旧一条被淘汰');
  });

  it('record 拒绝无效或异常短的耗时', async () => {
    const storage = createStorage();
    globalThis.Storage = storage;
    for (const bad of [0, -1, NaN, Infinity, 'x', 500]) {
      assert.equal(await Eta.record(bad), false, `${String(bad)} 不得记样本`);
    }
    assert.equal(Object.prototype.hasOwnProperty.call(storage.data, Eta.STORAGE_KEY), false);
  });

  it('expectedMs 读取存储后用中位数估算', async () => {
    globalThis.Storage = createStorage({
      [Eta.STORAGE_KEY]: [19000, 21000, 23000],
    });
    assert.equal(await Eta.expectedMs(), 21000);
  });

  it('无正式样本时从诊断记录挑「已生成」的耗时兜底，失败记录不参与', async () => {
    globalThis.Storage = createStorage({
      [Eta.DIAGNOSTICS_KEY]: [
        { result: 'success', elapsedMs: 20000 },
        { result: 'failed', elapsedMs: 300 },
        { result: 'post_failed', elapsedMs: 22000 },
        { result: 'no_post', elapsedMs: 24000 },
      ],
    });
    assert.equal(await Eta.expectedMs(), 22000, '升级后第一次点击也能用上历史耗时');
  });

  it('有正式样本时优先用样本，不让诊断历史重复计入', async () => {
    globalThis.Storage = createStorage({
      [Eta.STORAGE_KEY]: [30000],
      [Eta.DIAGNOSTICS_KEY]: [{ result: 'success', elapsedMs: 20000 }],
    });
    assert.equal(await Eta.expectedMs(), 30000);
  });

  it('存储不可用或读写抛错时回退默认值，不冒泡', async () => {
    delete globalThis.Storage;
    assert.deepEqual(await Eta.loadSamples(), []);
    assert.equal(await Eta.expectedMs(), 60000);
    assert.equal(await Eta.record(21000), false);

    globalThis.Storage = {
      async get() { throw new Error('storage broken'); },
      async set() { throw new Error('storage broken'); },
    };
    assert.deepEqual(await Eta.loadSamples(), []);
    assert.equal(await Eta.expectedMs(), 60000);
    assert.equal(await Eta.record(21000), false);
  });
});
