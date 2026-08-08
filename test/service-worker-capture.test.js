'use strict';

/**
 * service-worker.js 捕获链路集成测试（OPT-20260808-019 捕获写合批节流）
 *
 * 缺陷背景：修复前每个网络请求都触发一次 session storage 全量读改写
 * （最多 500 条数组 parse+stringify），work-panel 等轮询密集页面每分钟
 * 数十个请求 → 扩展进程 CPU/内存写风暴 + storage.onChanged 广播风暴。
 *
 * 本测试在 vm 沙箱中执行真实 service-worker.js 源码（importScripts 拼接），
 * 验证修复后三条核心契约：
 * 1. N 个已捕获请求在 1s 节流窗口内合批为 1 次 session storage 写入
 *    （写入发生在 flush 触发时，push 瞬间零 storage 读写）
 * 2. clearCapturedErrors 丢弃缓冲 pending，已清空的列表不被下一轮 flush 回写
 * 3. 2xx 成功请求瘦身存储（不携带任何 headers）
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

/** 捕获 webRequest handlers + 记录 session.set 完整历史 */
function makeChromeMock() {
  const webRequestHandlers = { onCompleted: null, onErrorOccurred: null };
  const sessionSets = []; // 每次 session.set 调用的参数快照
  const localGets = []; // 每次 local.get 的键集合（OPT-023 F1 缓存契约断言用）
  const onChangedHandlers = []; // storage.onChanged listeners（缓存兜底失效断言用）
  const localStore = {};
  const sessionStore = {};

  const listenerCapture = (key) => ({
    addListener: (fn) => { webRequestHandlers[key] = fn; },
  });

  const sessionArea = {
    get: async (keys) => {
      const out = {};
      for (const k of [].concat(keys)) out[k] = sessionStore[k];
      return out;
    },
    set: async (items) => {
      sessionSets.push({ ...items });
      Object.assign(sessionStore, items);
    },
    remove: async () => {},
  };

  return {
    webRequest: {
      onCompleted: listenerCapture('onCompleted'),
      onErrorOccurred: listenerCapture('onErrorOccurred'),
    },
    tabs: {
      onActivated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
      query: async () => [],
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
    runtime: {
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      id: 'test-ext-id',
    },
    commands: { onCommand: { addListener: () => {} } },
    storage: {
      local: {
        get: async (keys) => {
          localGets.push([].concat(keys));
          const out = {};
          for (const k of [].concat(keys)) out[k] = localStore[k];
          return out;
        },
        set: async (items) => Object.assign(localStore, items),
        remove: async () => {},
      },
      session: sessionArea,
      onChanged: { addListener: (fn) => onChangedHandlers.push(fn) },
    },
    __webRequestHandlers: webRequestHandlers,
    __sessionSets: sessionSets,
    __localGets: localGets,
    __onChangedHandlers: onChangedHandlers,
  };
}

function loadSW() {
  const chrome = makeChromeMock();
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

/** 合成 webRequest onCompleted 事件 */
function makeRequest({ statusCode = 500, statusLine = 'ERR', url = 'https://api.aidevpush.com/tasks/', tabId = 7, method = 'GET', withHeaders = true }) {
  return {
    tabId,
    url,
    method,
    statusCode,
    statusLine,
    type: 'xmlhttprequest',
    timeStamp: Date.now(),
    requestHeaders: withHeaders ? [
      { name: 'authorization', value: 'Token at_secret' },
      { name: 'cookie', value: 'session=abc' },
      { name: 'x-trace-id', value: 'trace-123' },
      { name: 'content-type', value: 'application/json' },
    ] : [],
    responseHeaders: withHeaders ? [
      { name: 'set-cookie', value: 'sid=1' },
      { name: 'content-type', value: 'application/json' },
    ] : [],
  };
}

/** session.set 中 capturedErrors 的每次写入快照 */
function capturedWrites(chrome) {
  return chrome.__sessionSets.filter((s) => 'capturedErrors' in s).map((s) => s.capturedErrors);
}

test('集成：10 个已捕获请求在 1s 窗口内合批为 1 次 session 写入，push 瞬间零存储读写', async () => {
  const { chrome, topLevelError } = await loadSW();
  assert.equal(topLevelError, null, `SW 顶层不得抛错: ${topLevelError}`);
  assert.ok(chrome.__webRequestHandlers.onCompleted, 'onCompleted handler 应被注册');

  // 10 个 5xx 请求（默认捕获配置全状态码 → 全部入捕获）
  for (let i = 0; i < 10; i++) {
    await chrome.__webRequestHandlers.onCompleted(makeRequest({ statusCode: 500, url: `https://api.aidevpush.com/tasks/${i}` }));
  }

  // 窗口未到时不得写 storage（修复前的行为：每次请求一次全量写）
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(capturedWrites(chrome).length, 0, 'flush 窗口内不得写 session storage');

  // 1s 节流窗口后：恰好 1 次批量写入，10 条完整
  await new Promise((r) => setTimeout(r, 1100));
  const writes = capturedWrites(chrome);
  assert.equal(writes.length, 1, `10 条应合批为 1 次写入，实际 ${writes.length} 次`);
  assert.equal(writes[0].length, 10, '批量写入应包含全部 10 条');
  assert.equal(writes[0][0].url, 'https://api.aidevpush.com/tasks/0');
  assert.equal(writes[0][9].url, 'https://api.aidevpush.com/tasks/9');
  // 每条都带 capturedAt（Storage 层统一添加）
  assert.ok(writes[0][0].capturedAt, '条目应带 capturedAt 时间戳');
});

test('集成：5xx 错误条目保留裁剪后 headers（authorization/cookie 不得落存储）', async () => {
  const { chrome } = await loadSW();
  await chrome.__webRequestHandlers.onCompleted(makeRequest({ statusCode: 503 }));
  await new Promise((r) => setTimeout(r, 1100));

  const writes = capturedWrites(chrome);
  assert.equal(writes.length, 1);
  const entry = writes[0][0];
  assert.equal(entry.statusCode, 503);
  assert.ok(entry.requestHeaders, '5xx 应保留诊断用请求头');
  assert.equal(entry.requestHeaders.authorization, undefined, 'authorization 必须裁剪');
  assert.equal(entry.requestHeaders.cookie, undefined, 'cookie 必须裁剪');
  assert.equal(entry.requestHeaders['x-trace-id'], 'trace-123', '非敏感头保留');
  assert.equal(entry.responseHeaders['set-cookie'], undefined, 'set-cookie 必须裁剪');
});

test('集成：2xx 成功请求瘦身存储（不携带任何 headers）', async () => {
  const { chrome } = await loadSW();
  await chrome.__webRequestHandlers.onCompleted(makeRequest({ statusCode: 200, statusLine: 'OK' }));
  await new Promise((r) => setTimeout(r, 1100));

  const writes = capturedWrites(chrome);
  assert.equal(writes.length, 1);
  const entry = writes[0][0];
  assert.equal(entry.statusCode, 200);
  assert.equal(entry.requestHeaders, undefined, '2xx 不得携带请求头');
  assert.equal(entry.responseHeaders, undefined, '2xx 不得携带响应头');
});

test('集成：clearCapturedErrors 丢弃缓冲 pending，清空后的列表不被下一轮 flush 回写', async () => {
  const { chrome } = await loadSWWithMessageCapture();

  // 先 push 5 条 → 进入缓冲 pending（窗口未到不落存储）
  for (let i = 0; i < 5; i++) {
    await chrome.__webRequestHandlers.onCompleted(makeRequest({ statusCode: 500, url: `https://api.aidevpush.com/tasks/c${i}` }));
  }
  // 同一窗口内 clearCapturedErrors → discard pending + 清空存储
  await chrome.__messageHandlers[0](
    { action: 'clearCapturedErrors' },
    { tab: { id: 7 } },
    () => {}
  );

  await new Promise((r) => setTimeout(r, 1100));

  const writes = capturedWrites(chrome);
  // 仅 clear 自身的一次清空写入（session.set({capturedErrors: []})）
  assert.equal(writes.length, 1, `缓冲 pending 不得在清空后回写，实际 ${writes.length} 次写入`);
  assert.deepEqual(writes[0], [], '最终存储应为空数组');
});

/** 与 loadSW 相同，但额外捕获 runtime.onMessage handler */
async function loadSWWithMessageCapture() {
  const base = makeChromeMock();
  const messageHandlers = [];
  const origAdd = base.runtime.onMessage.addListener.bind(base.runtime.onMessage);
  base.runtime.onMessage.addListener = (fn) => { messageHandlers.push(fn); origAdd(fn); };
  base.__messageHandlers = messageHandlers;

  const consoleLogs = [];
  const sandbox = {
    chrome: base,
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

  await new Promise((r) => setTimeout(r, 20));
  return { chrome: base, sandbox, consoleLogs, topLevelError };
}

/** 统计 mock 中读取 capture 配置键的 local.get 次数（OPT-20260808-023 F1 缓存契约） */
function captureConfigGets(chrome) {
  return chrome.__localGets.filter((keys) => keys.includes('captureEnabled')).length;
}

test('F1 缓存：N 个请求只读 1 次 capture 配置（热路径零 storage IPC）', async () => {
  const { chrome, topLevelError } = await loadSW();
  assert.equal(topLevelError, null, `SW 顶层不得抛错: ${topLevelError}`);
  // 启动 init 经 getCaptureConfigCached 暖缓存 → 基线 1 次
  assert.equal(captureConfigGets(chrome), 1, 'init 应暖缓存（1 次配置读取）');
  const baseline = captureConfigGets(chrome);

  // 修复前每个请求 1 次 local.get；修复后 15 个事件共享启动时的那 1 次
  for (let i = 0; i < 10; i++) {
    await chrome.__webRequestHandlers.onCompleted(makeRequest({ statusCode: 200 }));
  }
  for (let i = 0; i < 5; i++) {
    await chrome.__webRequestHandlers.onErrorOccurred({
      tabId: 7,
      url: 'https://api.aidevpush.com/canceled/',
      error: 'net::ERR_ABORTED',
      method: 'GET',
      type: 'xmlhttprequest',
      timeStamp: Date.now(),
    });
  }

  assert.equal(captureConfigGets(chrome), baseline, `15 个事件不得触发任何配置读取，实际 ${captureConfigGets(chrome) - baseline} 次`);

  // 默认配置全状态码 → 10×2xx（瘦身）+ 5×ERR_ABORTED 全部入捕获，1s 后 1 次合批写入
  await new Promise((r) => setTimeout(r, 1100));
  const writes = capturedWrites(chrome);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].length, 15, '10×2xx + 5×canceled 全部入捕获');
});

test('F1 缓存：setCaptureEnabled 主动失效后重读配置，禁用后不再捕获', async () => {
  const { chrome } = await loadSWWithMessageCapture();

  // 首次请求加载缓存（1 次读取）
  await chrome.__webRequestHandlers.onCompleted(makeRequest({ statusCode: 500 }));
  assert.equal(captureConfigGets(chrome), 1);

  // setCaptureEnabled(false) → 缓存失效。
  // 注意：onMessage listener 返回 true 而非 handler promise，需冲刷微任务
  // 等待 saveCaptureConfig → invalidateCaptureConfigCache 链完成，再发请求，
  // 否则请求会抢跑命中失效前的旧缓存。
  await chrome.__messageHandlers[0](
    { action: 'setCaptureEnabled', enabled: false, statusCodes: ['5xx'] },
    { tab: { id: 7 } },
    () => {},
  );
  await new Promise((r) => setTimeout(r, 0));

  // 下一请求应重读配置（enabled=false → 不入捕获、不写 session）
  await chrome.__webRequestHandlers.onCompleted(makeRequest({ statusCode: 500 }));
  assert.equal(captureConfigGets(chrome), 2, '配置写入后应重读一次');

  await new Promise((r) => setTimeout(r, 1100));
  const writes = capturedWrites(chrome);
  // 仅启用期间的首条 5xx 入捕获（禁用后的 5xx 不入捕获、不写 session）
  assert.equal(writes.length, 1, '仅启用期间的批次触发 1 次写入');
  assert.equal(writes[0].length, 1, '禁用后的 5xx 不得入捕获');
});

test('F1 缓存：storage.onChanged 兜底失效（Popup 等外部写入路径）', async () => {
  const { chrome } = await loadSW();
  assert.ok(chrome.__onChangedHandlers.length >= 1, 'SW 应注册 storage.onChanged listener');

  // 首次请求加载缓存
  await chrome.__webRequestHandlers.onCompleted(makeRequest({ statusCode: 200 }));
  assert.equal(captureConfigGets(chrome), 1);

  // 模拟 Popup 经 storage 直写配置 → onChanged 触发兜底失效
  const onChanged = chrome.__onChangedHandlers[chrome.__onChangedHandlers.length - 1];
  onChanged({ captureEnabled: { newValue: false } }, 'local');

  // 下一请求应重读配置
  await chrome.__webRequestHandlers.onCompleted(makeRequest({ statusCode: 200 }));
  assert.equal(captureConfigGets(chrome), 2, 'onChanged 失效后应重读一次');

  // 无关键变更不得触发失效
  onChanged({ token: { newValue: 'x' } }, 'local');
  await chrome.__webRequestHandlers.onCompleted(makeRequest({ statusCode: 200 }));
  assert.equal(captureConfigGets(chrome), 2, '无关键变更不得失效缓存');
});
