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
});
