'use strict';

/**
 * service-worker.js 回归单测：chrome.alarms 权限缺失时 SW 不得启动失败。
 *
 * 缺陷背景（2026-08-07）：manifest 缺 "alarms" 权限时 chrome.alarms 为 undefined，
 * 修复前 SW 顶层 `chrome.alarms.onAlarm.addListener(...)` 直接抛 TypeError →
 * SW 启动失败 → 扩展 runtime 消息通道双向全断（所有 sendMessage 超时）。
 * 修复：manifest 增加 "alarms" 权限 + SW 对 chrome.alarms 做 typeof 守卫。
 *
 * 本测试通过 vm 沙箱执行真实 service-worker.js 源码（拼接 importScripts 的 lib），
 * 断言：
 * 1. alarms 缺失（权限被移除的回归场景）→ SW 顶层执行不抛错，降级跳过
 * 2. alarms 可用 → SW 顶层执行不抛错，账号过期检测 alarm 正常创建
 *
 * 修复前该测试在场景 1 抛 `TypeError: Cannot read properties of undefined`，
 * 属 Red→Green 回归用例。
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert');

const SW_PATH = path.join(__dirname, '../background/service-worker.js');
const LIB_DIR = path.join(__dirname, '../lib');

/** 读取 SW 源码并展开 importScripts：把 lib 文件按顺序拼接进同一 script，
 *  保证顶层 const/let 声明共享（与浏览器 importScripts 的全局作用域语义一致）。 */
function buildSWScript() {
  const swSrc = fs.readFileSync(SW_PATH, 'utf8');
  const libs = [];
  const swBody = swSrc.replace(/importScripts\(([\s\S]*?)\);/, (_, args) => {
    for (const p of args.match(/'[^']+'/g) || []) {
      const file = p.replace(/'/g, '').replace('../lib/', '');
      libs.push(fs.readFileSync(path.join(LIB_DIR, file), 'utf8'));
    }
    return '';
  });
  return libs.join('\n') + '\n' + swBody;
}

/** 构造 chrome mock。withAlarms=false 模拟 manifest 缺 "alarms" 权限（chrome.alarms 为 undefined）。 */
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

/** 在 vm 沙箱中执行真实 SW 源码（同步顶层部分 + 微任务），返回捕获的顶层错误。 */
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

  // 顶层执行错误（同步抛出）：
  let topLevelError = null;
  try {
    vm.runInContext(buildSWScript(), sandbox, { filename: 'service-worker.js' });
  } catch (e) {
    topLevelError = e;
  }

  // 让 init IIFE 的微任务（storage 调用 + startAccountExpiryCheck）跑完
  return new Promise((resolve) => {
    setTimeout(() => resolve({ chrome, sandbox, consoleLogs, topLevelError }), 20);
  });
}

test('chrome.alarms 权限缺失时 SW 顶层执行不抛错（回归：修复前抛 TypeError → SW 启动失败）', async () => {
  const { topLevelError, consoleLogs } = await loadSW({ withAlarms: false });
  assert.equal(topLevelError, null, `权限缺失时顶层不得抛错，实际: ${topLevelError}`);
  assert.ok(
    consoleLogs.some((l) => l.includes('chrome.alarms 不可用')),
    '权限缺失时应输出降级告警日志'
  );
});

test('chrome.alarms 权限正常时 SW 顶层执行不抛错且创建账号过期检测 alarm', async () => {
  const { topLevelError, chrome, consoleLogs } = await loadSW({ withAlarms: true });
  assert.equal(topLevelError, null, `权限正常时顶层不得抛错，实际: ${topLevelError}`);
  assert.ok(
    chrome.__alarmsCreateCalls.some((c) => c.name === 'accountExpiryCheck'),
    '账号过期检测 alarm 应被创建'
  );
  assert.ok(
    consoleLogs.some((l) => l.includes('账号过期检测已启动')),
    '应输出账号过期检测启动日志'
  );
});
