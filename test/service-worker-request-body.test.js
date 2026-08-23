'use strict';

/**
 * SW 捕获 POST body：onBeforeRequest(requestBody) + lookupRequestBody
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');

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
  const webRequestHandlers = {};
  const messageHandlers = [];
  const listenerCapture = (key) => ({
    addListener: (fn) => { webRequestHandlers[key] = fn; },
  });
  return {
    webRequest: {
      onCompleted: listenerCapture('onCompleted'),
      onErrorOccurred: listenerCapture('onErrorOccurred'),
      onBeforeRequest: listenerCapture('onBeforeRequest'),
    },
    tabs: {
      onActivated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
      onDiscarded: { addListener: () => {} },
      query: async () => [],
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
    runtime: {
      onMessage: { addListener: (fn) => { messageHandlers.push(fn); } },
      onInstalled: { addListener: () => {} },
      id: 'test-ext-id',
    },
    commands: { onCommand: { addListener: () => {} } },
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener: () => {} },
    },
    __webRequestHandlers: webRequestHandlers,
    __messageHandlers: messageHandlers,
  };
}

async function loadSW() {
  const chrome = makeChromeMock();
  const sandbox = {
    chrome,
    console: { ...console, log: () => {}, warn: () => {}, error: () => {} },
    fetch: async () => { throw new Error('network disabled'); },
    setTimeout,
    clearTimeout,
    URL,
    Map,
    Set,
    Promise,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    AbortController,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildSWScript(), sandbox, { filename: 'service-worker.js' });
  await new Promise((r) => setTimeout(r, 20));
  return { chrome, sandbox };
}

function sendMessage(chrome, msg) {
  return new Promise((resolve, reject) => {
    const handler = chrome.__messageHandlers[0];
    const ret = handler(msg, { tab: { id: 3 } }, resolve);
    if (ret && typeof ret.then === 'function') {
      ret.then(resolve, reject);
    }
  });
}

test('onBeforeRequest captures JSON body; lookupRequestBody returns it', async () => {
  const { chrome } = await loadSW();
  assert.ok(chrome.__webRequestHandlers.onBeforeRequest, 'onBeforeRequest 必须顶层注册');

  const body = '{"sku":"a","qty":2}';
  const bytes = new TextEncoder().encode(body);
  const timeStamp = Date.now();
  chrome.__webRequestHandlers.onBeforeRequest({
    tabId: 3,
    method: 'POST',
    url: 'https://api.example.com/orders',
    timeStamp,
    requestId: 'req-10042',
    requestBody: { raw: [{ bytes }] },
    type: 'xmlhttprequest',
  });

  const res = await sendMessage(chrome, {
    action: 'lookupRequestBody',
    method: 'POST',
    url: 'https://api.example.com/orders',
    tabId: 3,
    timestamp: timeStamp + 120,
    requestId: 'req-10042',
  });
  assert.equal(res.success, true);
  assert.equal(res.body, body);
});

test('lookupRequestBody with requestId matches the right body among parallel same-URL POSTs', async () => {
  const { chrome } = await loadSW();
  const enc = new TextEncoder();
  const timeStamp = Date.now();
  const makeBody = (sku) => JSON.stringify({ sku });
  const handler = chrome.__webRequestHandlers.onBeforeRequest;
  // 同标签页 100ms 内两条同 URL POST，body 不同
  handler({
    tabId: 3,
    method: 'POST',
    url: 'https://api.example.com/orders',
    timeStamp,
    requestId: 'req-para-1',
    requestBody: { raw: [{ bytes: enc.encode(makeBody('a')) }] },
    type: 'xmlhttprequest',
  });
  handler({
    tabId: 3,
    method: 'POST',
    url: 'https://api.example.com/orders',
    timeStamp: timeStamp + 60,
    requestId: 'req-para-2',
    requestBody: { raw: [{ bytes: enc.encode(makeBody('b')) }] },
    type: 'xmlhttprequest',
  });

  const res2 = await sendMessage(chrome, {
    action: 'lookupRequestBody',
    method: 'POST',
    url: 'https://api.example.com/orders',
    tabId: 3,
    timestamp: timeStamp + 80,
    requestId: 'req-para-2',
  });
  assert.equal(res2.success, true);
  assert.equal(res2.body, makeBody('b'));
});
