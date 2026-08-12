'use strict';

/**
 * DevTools 请求列表「清空列表」— SW clearRecentRequests 契约
 *
 * 用户在 TaskPlugin 面板点「🗑️ 清空列表」后，须清空 SW 内存中的
 * devToolsRequests，使后续「🔄 刷新列表」不再拉回旧数据。
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert');

const SW_PATH = path.join(__dirname, '../background/service-worker.js');
const LIB_DIR = path.join(__dirname, '../lib');

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

function makeChromeMock() {
  const messageHandlers = [];
  return {
    webRequest: {
      onCompleted: { addListener: () => {} },
      onErrorOccurred: { addListener: () => {} },
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
      onMessage: {
        addListener: (fn) => { messageHandlers.push(fn); },
      },
      onInstalled: { addListener: () => {} },
      id: 'test-ext-id',
    },
    commands: { onCommand: { addListener: () => {} } },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
      session: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
      onChanged: { addListener: () => {} },
    },
    __messageHandlers: messageHandlers,
  };
}

async function loadSW() {
  const chrome = makeChromeMock();
  const sandbox = {
    chrome,
    console: {
      ...console,
      log: () => {},
      warn: () => {},
      error: () => {},
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
  return { chrome, topLevelError };
}

function sendMessage(chrome, msg) {
  return new Promise((resolve, reject) => {
    const handler = chrome.__messageHandlers[0];
    if (!handler) {
      reject(new Error('no runtime.onMessage handler'));
      return;
    }
    handler(msg, {}, (resp) => resolve(resp));
  });
}

test('clearRecentRequests：清空后 getRecentRequests 返回空列表', async () => {
  const { chrome, topLevelError } = await loadSW();
  assert.equal(topLevelError, null, `SW 顶层不得抛错: ${topLevelError}`);

  const req = {
    id: 'req-1',
    method: 'GET',
    url: 'https://api.example.com/a',
    statusCode: 200,
    timestamp: Date.now(),
  };
  const add = await sendMessage(chrome, { action: 'addRecentRequest', request: req });
  assert.equal(add?.success, true);

  const before = await sendMessage(chrome, { action: 'getRecentRequests', limit: 200 });
  assert.equal(before?.success, true);
  assert.equal(before.data.length, 1);
  assert.equal(before.data[0].id, 'req-1');

  const cleared = await sendMessage(chrome, { action: 'clearRecentRequests' });
  assert.equal(cleared?.success, true, 'clearRecentRequests 必须成功（修复前无此 action）');

  const after = await sendMessage(chrome, { action: 'getRecentRequests', limit: 200 });
  assert.equal(after?.success, true);
  assert.deepEqual(after.data, [], '清空后刷新不得再拉回旧请求');
});
