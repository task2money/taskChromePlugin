'use strict';

/**
 * SW 侧 Alt+Z waterfall 编排（Task 13 修复轮：删除无调用方的
 * wrapBuiltinAdvisorNotify 后，模块对外行为保持不变）。
 */

const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');

function loadTimingRun(extra = {}) {
  const calls = { complete: [], fail: [], sent: [], notify: [] };
  const sandbox = {
    console,
    crypto: { randomUUID: () => 'uuid-1' },
    chrome: {
      runtime: { sendMessage: (msg) => { calls.sent.push(msg); } },
      tabs: { sendMessage: (tabId, msg) => { calls.sent.push({ tabId, msg }); } },
      storage: { session: { get: async () => ({}), set: async () => {} } },
    },
    PageAdvisorTiming: {
      MAX_HISTORY: 10,
      createRun: (opts) => ({ runId: opts.runId, route: opts.route, command: opts.command }),
      seedPlannedSpans: () => {},
      serialize: (run) => ({ runId: run.runId }),
      rememberHistory: () => [],
      completeRun: (run) => calls.complete.push(run),
      failRun: (run, _now, traceId) => calls.fail.push({ run, traceId }),
    },
    notifyContentPageAdvisor: async (tabId, body) => {
      calls.notify.push({ tabId, body });
    },
    ...(extra.sandbox || {}),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'background/sw-page-advisor-timing-run.js'), 'utf8'),
    sandbox,
    { filename: 'sw-page-advisor-timing-run.js' },
  );
  return { sandbox, calls };
}

describe('sw-page-advisor-timing-run', () => {
  it('notifyPageAdvisorDone 透传 waterfallRunId 并标记 run 完成', async () => {
    const { sandbox, calls } = loadTimingRun();
    const run = { runId: 'run-9' };

    await sandbox.notifyPageAdvisorDone(
      9,
      { ok: true, traceId: 'trace-9' },
      async (_id, fn) => fn(),
      run,
    );

    assert.equal(calls.notify.length, 1);
    assert.equal(calls.notify[0].tabId, 9);
    assert.equal(calls.notify[0].body.waterfallRunId, 'run-9');
    assert.equal(calls.notify[0].body.traceId, 'trace-9');
    assert.deepEqual(calls.complete, [run]);
    assert.equal(calls.fail.length, 0);
  });

  it('beginPageAdvisorTimingRun 生成 run 并广播到侧栏与采集 tab', () => {
    const { sandbox, calls } = loadTimingRun();

    const run = sandbox.beginPageAdvisorTimingRun('saas', 'alt-z');

    assert.equal(run.runId, 'wf_uuid-1');
    assert.equal(run.command, 'alt-z');
    const broadcasts = calls.sent.filter((m) => m && m.action === 'pageAdvisorWaterfall');
    assert.ok(broadcasts.length >= 1);
  });

  it('命令标记消费一次后回到默认 alt-z', () => {
    const { sandbox } = loadTimingRun();

    sandbox.markPageAdvisorSuggestCommand('alt-shift-z');
    assert.equal(sandbox.consumePageAdvisorSuggestCommand(), 'alt-shift-z');
    assert.equal(sandbox.consumePageAdvisorSuggestCommand(), 'alt-z');
  });
});
