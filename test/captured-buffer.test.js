'use strict';

/**
 * captured-buffer.js 回归单测（OPT-20260808-019 捕获写合批节流）
 *
 * 背景：SW 对每个网络请求做 session storage 全量读改写（500 条数组 parse+stringify），
 * work-panel 等轮询密集型页面把扩展进程打成 CPU/内存写风暴。
 * 修复：内存缓冲 + 1s 节流合批写入，每请求只 push 内存数组，每秒至多一次全量写。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const CapturedBuffer = require('../lib/captured-buffer.js');

const { createCapturedBuffer } = CapturedBuffer;

/** 手工调度器：不自动触发，测试显式驱动 flush 计时 */
function manualScheduler() {
  const scheduled = [];
  return {
    scheduled,
    schedule(fn, ms) {
      const job = { fn, ms, cancelled: false };
      scheduled.push(job);
      return job;
    },
    cancel(job) {
      if (job) job.cancelled = true;
    },
    fireAll() {
      const jobs = scheduled.splice(0, scheduled.length);
      for (const j of jobs) {
        if (!j.cancelled) j.fn();
      }
    },
  };
}

describe('createCapturedBuffer 合批节流', () => {
  it('10 条请求只触发 1 次 flush（节流窗口内合批）', async () => {
    const scheduler = manualScheduler();
    const flushed = [];
    const buf = createCapturedBuffer({
      flush: async (batch) => { flushed.push(batch); },
      flushIntervalMs: 1000,
      scheduler,
    });

    for (let i = 0; i < 10; i++) buf.push({ id: i });
    assert.equal(flushed.length, 0, '窗口内不得立即 flush');

    scheduler.fireAll();
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(flushed.length, 1);
    assert.equal(flushed[0].length, 10, '10 条一次合批写入');
    assert.deepEqual(flushed[0].map((e) => e.id), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('窗口内再次 push 不重复调度 flush（同一批次）', async () => {
    const scheduler = manualScheduler();
    const flushed = [];
    const buf = createCapturedBuffer({
      flush: async (batch) => { flushed.push(batch); },
      flushIntervalMs: 1000,
      scheduler,
    });

    buf.push({ id: 1 });
    const scheduledCountAfterFirst = scheduler.scheduled.length;
    buf.push({ id: 2 });
    buf.push({ id: 3 });
    assert.equal(scheduler.scheduled.length, scheduledCountAfterFirst, '重复 push 不得重复调度');

    scheduler.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushed.length, 1);
    assert.equal(flushed[0].length, 3);
  });

  it('达到 maxEntries 上限时立即 flush（不等待窗口）', async () => {
    const scheduler = manualScheduler();
    const flushed = [];
    const buf = createCapturedBuffer({
      flush: async (batch) => { flushed.push(batch); },
      flushIntervalMs: 1000,
      maxEntries: 5,
      scheduler,
    });

    for (let i = 0; i < 5; i++) buf.push({ id: i });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushed.length, 1, '满 5 条立即 flush');
    assert.equal(flushed[0].length, 5);

    // 后续条目继续进入新窗口
    buf.push({ id: 5 });
    scheduler.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushed.length, 2);
    assert.deepEqual(flushed[1].map((e) => e.id), [5]);
  });

  it('flush 成功后队列清空，窗口计时器复用', async () => {
    const scheduler = manualScheduler();
    const flushed = [];
    const buf = createCapturedBuffer({
      flush: async (batch) => { flushed.push(batch); },
      flushIntervalMs: 1000,
      scheduler,
    });

    buf.push({ id: 1 });
    scheduler.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushed.length, 1);

    buf.push({ id: 2 });
    assert.equal(scheduler.scheduled.length, 1, '新一轮窗口重新调度');
    scheduler.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushed.length, 2);
    assert.deepEqual(flushed[1].map((e) => e.id), [2]);
  });

  it('flush 抛错时批次重新入队并重试，不丢数据', async () => {
    const scheduler = manualScheduler();
    const flushed = [];
    let failFirst = true;
    const buf = createCapturedBuffer({
      flush: async (batch) => {
        if (failFirst) {
          failFirst = false;
          throw new Error('storage quota exceeded');
        }
        flushed.push(batch);
      },
      flushIntervalMs: 1000,
      scheduler,
    });

    buf.push({ id: 1 });
    buf.push({ id: 2 });
    scheduler.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushed.length, 0, '首次失败不丢弃');

    // 重试由失败后的重新调度触发（或下一次 push 满额触发）
    scheduler.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushed.length, 1, '失败后重试成功');
    assert.deepEqual(flushed[0].map((e) => e.id), [1, 2], '失败批次完整重放');
  });

  it('flush 在途期间新 push 进入下一批次（不并发写同一批）', async () => {
    const scheduler = manualScheduler();
    const flushed = [];
    let resolveFlush;
    const gate = new Promise((r) => { resolveFlush = r; });
    const buf = createCapturedBuffer({
      flush: async (batch) => {
        flushed.push(batch);
        await gate;
      },
      flushIntervalMs: 1000,
      scheduler,
    });

    buf.push({ id: 1 });
    scheduler.fireAll(); // flush 开始并挂起
    buf.push({ id: 2 }); // 在途期间 push

    resolveFlush();
    await new Promise((r) => setTimeout(r, 0));

    // 挂起的 flush 完成后，第二条进入新一轮调度
    scheduler.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushed.length, 2);
    assert.deepEqual(flushed[0].map((e) => e.id), [1]);
    assert.deepEqual(flushed[1].map((e) => e.id), [2]);
  });

  it('discard 丢弃 pending，后续不再 flush', async () => {
    const scheduler = manualScheduler();
    const flushed = [];
    const buf = createCapturedBuffer({
      flush: async (batch) => { flushed.push(batch); },
      flushIntervalMs: 1000,
      scheduler,
    });

    buf.push({ id: 1 });
    buf.push({ id: 2 });
    buf.discard();
    scheduler.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushed.length, 0, 'discard 后不得 flush 已丢弃数据');

    buf.push({ id: 3 });
    scheduler.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(flushed.map((b) => b.map((e) => e.id)), [[3]], 'discard 后新条目正常合批');
  });

  it('空队列 flush 为 no-op', async () => {
    const scheduler = manualScheduler();
    let flushCalls = 0;
    const buf = createCapturedBuffer({
      flush: async () => { flushCalls++; },
      flushIntervalMs: 1000,
      scheduler,
    });

    scheduler.fireAll(); // 没有 push 过，不应调度
    assert.equal(flushCalls, 0);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushCalls, 0);
  });

  it('F2：连续失败达 maxRetries 时丢弃最旧批次并停止重试（无退避热循环）', async () => {
    const scheduler = manualScheduler();
    let flushCalls = 0;
    const buf = createCapturedBuffer({
      flush: async () => { flushCalls++; throw new Error('storage quota exceeded'); },
      flushIntervalMs: 1000,
      maxEntries: 5,
      maxRetries: 3,
      scheduler,
    });

    // scheduled 中可能残留已取消的窗口计时器（cancel 仅置标记），断言只看活跃计时器
    const activeMs = () => scheduler.scheduled.filter((j) => !j.cancelled).map((j) => j.ms);

    for (let i = 0; i < 5; i++) buf.push({ id: i });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushCalls, 1, '满 5 条立即首次 flush');

    // 指数退避序列：1s → 2s（绝不立即无退避重试）
    assert.deepEqual(activeMs(), [1000], '首次失败后按 1s 退避调度');
    scheduler.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushCalls, 2);
    assert.deepEqual(activeMs(), [2000], '第二次失败后按 2s 退避调度');

    // 第 3 次失败 → 丢弃最旧批次，pending 清空，不再调度
    scheduler.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushCalls, 3, '达到 maxRetries 后不再重试');
    assert.equal(buf.pendingCount, 0, '失败批次被丢弃');

    scheduler.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushCalls, 3, '丢弃后不得再有 flush 尝试');
  });

  it('F2：失败后成功 → 失败计数重置，不累积退避', async () => {
    const scheduler = manualScheduler();
    const flushed = [];
    let failNext = true;
    const buf = createCapturedBuffer({
      flush: async (batch) => {
        if (failNext) {
          failNext = false;
          throw new Error('transient');
        }
        flushed.push(batch);
      },
      flushIntervalMs: 1000,
      maxEntries: 3,
      scheduler,
    });

    // scheduled 中可能残留已取消的窗口计时器（cancel 仅置标记），断言只看活跃计时器
    const activeMs = () => scheduler.scheduled.filter((j) => !j.cancelled).map((j) => j.ms);

    // 第一次失败 → 退避 1s
    buf.push({ id: 1 }); buf.push({ id: 2 }); buf.push({ id: 3 });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushed.length, 0);
    assert.deepEqual(activeMs(), [1000], '失败后进入退避');

    // 退避后重试成功 → 计数重置
    scheduler.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushed.length, 1);
    assert.deepEqual(flushed[0].map((e) => e.id), [1, 2, 3]);

    // 再次失败一次后成功：退避仍从 1s 起步（不累积为 2s/4s）
    failNext = true;
    buf.push({ id: 4 }); buf.push({ id: 5 }); buf.push({ id: 6 });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushed.length, 1, '计数已重置：失败后批次重新入队，未丢弃');
    assert.deepEqual(activeMs(), [1000], '重置后退避从 1s 重新起步（不累积）');
    scheduler.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(flushed.length, 2, '重试后第二批最终成功');
    assert.deepEqual(flushed[1].map((e) => e.id), [4, 5, 6]);
  });
});
