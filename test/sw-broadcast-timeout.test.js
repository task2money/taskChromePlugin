'use strict';

/**
 * OPT-20260808-023 F3 广播超时回归测试
 *
 * 缺陷背景：SW 向所有标签页/子 frame 广播时直接 await chrome.tabs.sendMessage。
 * 被 Memory Saver 冻结 / discarded 的标签页或卡死子 frame 上，sendMessage 的
 * Promise 永不 settle → 无超时兜底下消息处理悬挂：泄漏 pending Promise、
 * 阻止 SW 休眠（每次广播卡死一处）。
 *
 * 修复契约（withTimeout 800ms 兜底）：
 * 1. elementPickerShortcut / pickToChildFrames 广播
 *    对挂起标签页 ≤800ms settle
 * 2. 健康标签页立即 settle，其超时计时器被清除（快路径不受 800ms 拖累）
 * 3. broadcastPickToChildFrames 并行发送：任一 frame 挂起不阻塞其余广播
 *    （修复前串行 await，第 1 个挂起 frame 会拖死后续全部）
 *
 * 计时用注入的手工 setTimeout：测试显式 advance(800) 驱动超时，零真实等待。
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert');

const SW_PATH = path.join(__dirname, '../background/service-worker.js');
const LIB_DIR = path.join(__dirname, '../lib');

/** 展开 importScripts 拼接 lib 源码（与浏览器 importScripts 共享全局作用域一致） */
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

/** 手工计时器：替代真实 setTimeout，测试显式推进时钟 */
function manualTimers() {
  const pending = [];
  let seq = 0;
  return {
    pending,
    setTimeout(fn, ms) {
      const t = { id: ++seq, fn, ms, cleared: false };
      pending.push(t);
      return t;
    },
    clearTimeout(t) {
      if (t) t.cleared = true;
    },
    /** 同步触发所有未清除且 ms <= deadline 的计时器 */
    advance(deadline) {
      for (const t of pending) {
        if (!t.cleared && t.ms <= deadline) {
          t.cleared = true;
          t.fn();
        }
      }
    },
    /** 未清除且 ms <= deadline 的存活计时器数 */
    count(deadline) {
      return pending.filter((t) => !t.cleared && t.ms <= deadline).length;
    },
  };
}

/**
 * SW 运行 mock。opts：
 * - tabs: chrome.tabs.query 返回的标签列表
 * - frames: chrome.webNavigation.getAllFrames 返回的 frame 列表
 * - sendMessage(tabId, message, opts): 自定义 sendMessage 实现（挂起/立即返回）
 */
function makeChromeMock(opts = {}) {
  const tabs = opts.tabs || [];
  const frames = opts.frames || [];
  const sent = [];
  const messageHandlers = [];
  const localStore = {};
  const sessionStore = {};

  const sendMessageImpl = opts.sendMessage || (() => Promise.resolve({}));

  return {
    webRequest: {
      onCompleted: { addListener: () => {} },
      onErrorOccurred: { addListener: () => {} },
    },
    webNavigation: {
      getAllFrames: async () => frames,
    },
    tabs: {
      onActivated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
      onDiscarded: { addListener: () => {} },
      query: async () => tabs,
      sendMessage: async (tabId, message, sendOpts) => {
        const p = sendMessageImpl(tabId, message, sendOpts);
        sent.push({ tabId, message, opts: sendOpts || null });
        return p;
      },
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
    commands: {
      update: async () => {},
      onCommand: { addListener: () => {} },
    },
    runtime: {
      onMessage: { addListener: (fn) => messageHandlers.push(fn) },
      onInstalled: { addListener: () => {} },
      id: 'test-ext-id',
    },
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          for (const k of [].concat(keys)) out[k] = localStore[k];
          return out;
        },
        set: async (items) => Object.assign(localStore, items),
        remove: async () => {},
      },
      session: {
        get: async (keys) => {
          const out = {};
          for (const k of [].concat(keys)) out[k] = sessionStore[k];
          return out;
        },
        set: async (items) => Object.assign(sessionStore, items),
        remove: async () => {},
      },
      onChanged: { addListener: () => {} },
    },
    __sent: sent,
    __messageHandlers: messageHandlers,
  };
}

function loadSW(chrome) {
  const timers = manualTimers();
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
    setTimeout: (fn, ms) => timers.setTimeout(fn, ms),
    clearTimeout: (t) => timers.clearTimeout(t),
    URL,
    Map,
    Set,
    Promise,
    AbortController,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(buildSWScript(), sandbox, { filename: 'service-worker.js' });
  return { timers, consoleLogs };
}

/** 触发 SW 消息监听器并捕获 sendResponse 调用 */
function invokeMessage(chrome, message, sender) {
  const calls = { count: 0, resp: null };
  chrome.__messageHandlers[0](message, sender, (resp) => {
    calls.count++;
    calls.resp = resp;
  });
  return calls;
}

/** 冲刷微任务（vm 沙箱与宿主共享微任务队列，setImmediate 即可排空） */
const flush = () => new Promise((r) => setImmediate(r));

test('F3 elementPickerShortcut：挂起标签页不阻塞消息响应，≤800ms 兜底收尾', async () => {
  let hungCalls = 0;
  const chrome = makeChromeMock({
    tabs: [{ id: 1 }, { id: 2 }],
    sendMessage: (tabId) => {
      if (tabId === 2) { hungCalls++; return new Promise(() => {}); }
      return Promise.resolve({});
    },
  });
  const { timers } = loadSW(chrome);

  const calls = invokeMessage(chrome, { action: 'setElementPickerShortcut', shortcut: 'Alt+Shift+E' }, { tab: { id: 1 } });
  await flush();

  // 广播是 fire-and-forget：响应不被挂起标签页阻塞（恢复快捷键设置不再卡死 Popup）
  assert.equal(calls.count, 1, '消息响应不得等待广播完成');
  assert.equal(calls.resp.success, true);
  assert.deepEqual(chrome.__sent.map((s) => s.tabId).sort(), [1, 2], '广播应发给全部标签页');
  assert.equal(hungCalls, 1);

  // 挂起标签页被 withTimeout 包裹 → 800ms 兜底计时器存活，推进后无残留
  assert.equal(timers.count(800), 1, '挂起标签页应有 800ms 兜底计时器');
  timers.advance(800);
  await flush();
  assert.equal(timers.count(800), 0, '兜底后无残留计时器（无永久悬挂 promise）');
});

test('F3 broadcastPickToChildFrames：并行广播，挂起 frame ≤800ms settle 且不阻塞其余', async () => {
  const chrome = makeChromeMock({
    tabs: [{ id: 5 }],
    frames: [{ frameId: 0 }, { frameId: 1 }, { frameId: 2 }, { frameId: 3 }],
    sendMessage: (tabId, msg, sendOpts) => {
      if (sendOpts && sendOpts.frameId === 1) return new Promise(() => {}); // 挂起子 frame
      return Promise.resolve({ success: true });
    },
  });
  const { timers } = loadSW(chrome);

  const calls = invokeMessage(chrome, { action: 'broadcastStartElementPick', source: 'float' }, { tab: { id: 5 } });
  await flush();

  // 并发契约：3 个子 frame 全部在超时前发起（修复前串行 await 会卡死在 frame 1）
  assert.equal(chrome.__sent.length, 3, '所有子 frame 应同时发起广播');
  assert.deepEqual(chrome.__sent.map((s) => s.opts.frameId).sort(), [1, 2, 3], '顶层 frame 0 不应收到（仅子 frame）');
  assert.equal(calls.count, 0, '挂起 frame 未兜底前不得返回');

  timers.advance(800);
  await flush();
  assert.equal(calls.count, 1, '3 个子 frame（含挂起）总耗时 ≤800ms（并行而非 3×800ms 串行）');
  assert.equal(calls.resp.success, true);
  assert.equal(timers.count(800), 0, '兜底后无残留计时器');
});
