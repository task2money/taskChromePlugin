'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { withTimeout, startWatchdog } = require('../lib/async-timeout.js');

describe('async-timeout helpers', () => {
  it('withTimeout resolves when promise finishes in time', async () => {
    const value = await withTimeout(Promise.resolve('ok'), 200, 'fast');
    assert.equal(value, 'ok');
  });

  it('withTimeout rejects when promise hangs past deadline', async () => {
    const hanging = new Promise(() => {});
    await assert.rejects(
      () => withTimeout(hanging, 40, 'hang'),
      /hang超时\(40ms\)/,
    );
  });

  it('withTimeout propagates underlying rejection before timeout', async () => {
    await assert.rejects(
      () => withTimeout(Promise.reject(new Error('boom')), 200, 'fail'),
      /boom/,
    );
  });

  it('startWatchdog fires onTimeout then cancel reports fired', async () => {
    let calls = 0;
    const wd = startWatchdog(30, () => { calls += 1; });
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(calls, 1);
    assert.equal(wd.fired, true);
    assert.equal(wd.cancel(), true);
  });

  it('startWatchdog cancel before fire prevents onTimeout', async () => {
    let calls = 0;
    const wd = startWatchdog(80, () => { calls += 1; });
    assert.equal(wd.cancel(), false);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(calls, 0);
    assert.equal(wd.fired, false);
  });
});

/**
 * 回归：catch 路径若 await 挂起的 storage，会阻塞 finally 隐藏 spinner。
 * 正确模式：catch 只同步切 UI，finally 同步 hide，restore 放到 finally 之后。
 */
describe('popup init finally must not await hanging restore', () => {
  it('hideLoading runs even when catch-side restore hangs forever', async () => {
    let spinnerVisible = true;
    let loginVisible = false;
    const hangForever = () => new Promise(() => {});

    async function initLike() {
      try {
        throw new Error('登录状态检查超时(50ms)');
      } catch (_e) {
        loginVisible = true;
        // 错误示范曾在此处 await hangForever() —— 会堵死 finally
      } finally {
        spinnerVisible = false;
      }
      hangForever().catch(() => {});
    }

    await initLike();
    assert.equal(spinnerVisible, false);
    assert.equal(loginVisible, true);
  });

  it('broken pattern: await hanging restore before finally blocks hide', async () => {
    let spinnerVisible = true;
    const hangForever = () => new Promise(() => {});

    async function brokenInit() {
      try {
        throw new Error('timeout');
      } catch (_e) {
        await hangForever(); // 历史 bug
      } finally {
        spinnerVisible = false;
      }
    }

    const raced = await Promise.race([
      brokenInit().then(() => 'done'),
      new Promise((resolve) => setTimeout(() => resolve('watchdog'), 80)),
    ]);
    assert.equal(raced, 'watchdog');
    assert.equal(spinnerVisible, true, 'finally 未执行，spinner 仍可见');
  });
});
