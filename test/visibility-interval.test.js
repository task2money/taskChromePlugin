'use strict';

/**
 * 可见性感知 interval：hidden 停表、可见恢复、in-flight 不重叠。
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { createVisibilityAwareInterval } = require('../lib/visibility-interval.js');

function makeClock() {
  const timers = new Map();
  let nextId = 1;
  let hidden = false;
  const visListeners = [];
  return {
    get hidden() { return hidden; },
    setHidden(v) {
      hidden = v;
      for (const fn of visListeners) fn();
    },
    setIntervalFn(fn, _ms) {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearIntervalFn(id) {
      timers.delete(id);
    },
    tickAll() {
      for (const fn of [...timers.values()]) fn();
    },
    get timerCount() { return timers.size; },
    addVisibilityListener(fn) { visListeners.push(fn); },
    removeVisibilityListener(fn) {
      const i = visListeners.indexOf(fn);
      if (i >= 0) visListeners.splice(i, 1);
    },
  };
}

describe('createVisibilityAwareInterval', () => {
  let clock;
  let ticks;

  beforeEach(() => {
    clock = makeClock();
    ticks = 0;
  });

  function makeCtl(onTick) {
    return createVisibilityAwareInterval({
      intervalMs: 60_000,
      onTick: onTick || (() => { ticks += 1; }),
      isHidden: () => clock.hidden,
      addVisibilityListener: (fn) => clock.addVisibilityListener(fn),
      removeVisibilityListener: (fn) => clock.removeVisibilityListener(fn),
      setIntervalFn: (fn, ms) => clock.setIntervalFn(fn, ms),
      clearIntervalFn: (id) => clock.clearIntervalFn(id),
    });
  }

  it('start 时若页面可见则挂 interval', () => {
    const ctl = makeCtl();
    ctl.start();
    assert.equal(clock.timerCount, 1);
    clock.tickAll();
    assert.equal(ticks, 1);
    ctl.stop();
  });

  it('hidden 时 start 不挂 interval（修复前每个后台标签页都有 60s 定时器）', () => {
    clock.setHidden(true);
    const ctl = makeCtl();
    ctl.start();
    assert.equal(clock.timerCount, 0);
    ctl.stop();
  });

  it('变为 hidden 后清 interval；再可见则恢复并立即 tick 一次', async () => {
    const ctl = makeCtl();
    ctl.start();
    assert.equal(clock.timerCount, 1);
    clock.setHidden(true);
    assert.equal(clock.timerCount, 0);
    clock.setHidden(false);
    assert.equal(clock.timerCount, 1);
    await Promise.resolve();
    assert.equal(ticks, 1, '恢复可见应立即补一次角标刷新');
    ctl.stop();
  });

  it('onTick 未完成时后续拍跳过', async () => {
    let release;
    const pending = new Promise((r) => { release = r; });
    let started = 0;
    const ctl = makeCtl(async () => {
      started += 1;
      await pending;
    });
    ctl.start();
    clock.tickAll();
    clock.tickAll();
    await Promise.resolve();
    assert.equal(started, 1);
    release();
    await pending;
    ctl.stop();
  });

  it('stop 清除 interval 与 visibility 监听', () => {
    const ctl = makeCtl();
    ctl.start();
    ctl.stop();
    assert.equal(clock.timerCount, 0);
    clock.setHidden(true);
    clock.setHidden(false);
    assert.equal(clock.timerCount, 0, 'stop 后可见性变化不得再挂表');
  });
});
