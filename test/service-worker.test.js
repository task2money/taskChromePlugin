'use strict';

/**
 * service-worker.js 回归：正式包不再声明 alarms，SW 不得依赖 chrome.alarms。
 *
 * 历史（2026-08-07）：曾在顶层无守卫调用 chrome.alarms → TypeError → SW 挂死。
 * 现策略（2026-09-16）：删除后台定时过期扫描，仅用时校验；importScripts 不再含 sw-expiry。
 */

const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert');

const { buildSWScript } = require('./helpers/swBundle.js');

function makeChromeMock({ withAlarms }) {
  const alarmsCreateCalls = [];
  const listenerAdder = () => ({ addListener: () => {} });
  return {
    alarms: withAlarms
      ? {
          get: (name, cb) => cb(null),
          create: (name, opts) => { alarmsCreateCalls.push({ name, opts }); },
          onAlarm: { addListener: () => {} },
        }
      : undefined,
    webRequest: { onCompleted: listenerAdder(), onErrorOccurred: listenerAdder() },
    tabs: {
      onActivated: listenerAdder(),
      onRemoved: listenerAdder(),
      onUpdated: listenerAdder(),
      query: async () => [],
    },
    runtime: {
      onMessage: { addListener: () => {} },
      onInstalled: listenerAdder(),
      id: 'test-ext-id',
    },
    commands: { onCommand: listenerAdder() },
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      session: { get: async () => ({}) },
    },
    __alarmsCreateCalls: alarmsCreateCalls,
  };
}

function loadSW({ withAlarms }) {
  const chrome = makeChromeMock({ withAlarms });
  const consoleLogs = [];
  const sandbox = {
    chrome,
    console: {
      ...console,
      log: (...a) => consoleLogs.push(a.join(' ')),
      warn: (...a) => consoleLogs.push('WARN: ' + a.join(' ')),
      error: (...a) => consoleLogs.push('ERROR: ' + a.join(' ')),
    },
    fetch: async () => { throw new Error('network disabled in test'); },
    setTimeout,
    clearTimeout,
    URL,
    Map,
    Set,
    Promise,
    AbortController,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);

  let topLevelError = null;
  try {
    vm.runInContext(buildSWScript(), sandbox, { filename: 'service-worker.js' });
  } catch (e) {
    topLevelError = e;
  }

  return new Promise((resolve) => {
    setTimeout(() => resolve({ chrome, sandbox, consoleLogs, topLevelError }), 20);
  });
}

test('chrome.alarms 不可用时 SW 顶层执行不抛错', async () => {
  const { topLevelError } = await loadSW({ withAlarms: false });
  assert.equal(topLevelError, null, `顶层不得抛错，实际: ${topLevelError}`);
});

test('即使 chrome.alarms 可用也不创建账号过期 alarm（已删除定时扫）', async () => {
  const { topLevelError, chrome, consoleLogs } = await loadSW({ withAlarms: true });
  assert.equal(topLevelError, null, `顶层不得抛错，实际: ${topLevelError}`);
  assert.equal(
    chrome.__alarmsCreateCalls.length,
    0,
    '不得创建任何 chrome.alarms',
  );
  assert.ok(
    !consoleLogs.some((l) => l.includes('账号过期检测已启动')),
    '不得输出账号过期检测启动日志',
  );
});
