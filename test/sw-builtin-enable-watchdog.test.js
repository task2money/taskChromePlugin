'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const runtime = require('../lib/page-advisor-builtin-runtime.js');

test('builtin-enable-watchdog alarm 恢复超时 inFlight', async () => {
  const store = {
    pageAdvisorBuiltinRuntime: {
      phase: 'downloading',
      availability: 'downloading',
      downloadPct: 100,
      downloadInFlight: true,
      enableHundredAt: Date.now() - 200_000,
      updatedAt: Date.now() - 200_000,
    },
  };
  const alarmFns = [];
  const context = {
    chrome: {
      alarms: {
        onAlarm: { addListener: (fn) => alarmFns.push(fn) },
      },
      storage: {
        session: {
          async get(key) { return { [key]: store[key] }; },
          async set(bag) { Object.assign(store, bag); },
        },
      },
    },
    PageAdvisorBuiltinRuntime: runtime,
    globalThis: null,
  };
  context.globalThis = context;
  const prevChrome = globalThis.chrome;
  globalThis.chrome = context.chrome;
  try {
    vm.createContext(context);
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '../background/sw-builtin-enable-watchdog.js'), 'utf8'),
      context,
    );
    assert.equal(alarmFns.length, 1);
    await alarmFns[0]({ name: 'builtin-enable-watchdog' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(store.pageAdvisorBuiltinRuntime.downloadInFlight, false);
  } finally {
    globalThis.chrome = prevChrome;
  }
});
