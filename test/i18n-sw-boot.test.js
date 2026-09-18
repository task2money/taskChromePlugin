'use strict';

/**
 * OPT-20260919-009 第 7 批：service worker 装载 i18n 并在对外入口等待 hydrate。
 *
 * importScripts 是同步的，hydrateFromStorage 读 chrome.storage 却是异步的。
 * 只把 lib/i18n*.js 加进 importScripts 只能让 tx() 存在，locale 仍会是 zh-CN 默认值；
 * 必须在每个对外入口 await 就绪门，否则冷启动后的首批消息切 en 无效。
 */

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const I18N_SCRIPTS = [
  '../lib/i18n.js',
  '../lib/i18n-messages.js',
  '../lib/i18n-ui-messages.js',
  '../lib/i18n-tx.js',
];

function swSource() {
  return fs.readFileSync(path.join(ROOT, 'background/service-worker.js'), 'utf8');
}

function makeChromeMock(opts = {}) {
  const messageHandlers = [];
  const commandHandlers = [];
  const localStore = Object.assign({}, opts.localStore);
  return {
    webRequest: {
      onCompleted: { addListener: () => {} },
      onErrorOccurred: { addListener: () => {} },
    },
    webNavigation: {
      getAllFrames: async () => [{ frameId: 0 }],
      onCompleted: { addListener: () => {} },
    },
    tabs: {
      onActivated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
      onDiscarded: { addListener: () => {} },
      query: async () => [{ id: 9 }],
      sendMessage: async () => ({ success: true }),
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
    commands: {
      update: async () => {},
      getAll: async () => [],
      onCommand: { addListener: (fn) => commandHandlers.push(fn) },
    },
    runtime: {
      onMessage: { addListener: (fn) => messageHandlers.push(fn) },
      onInstalled: { addListener: () => {} },
      id: 'test-ext-id',
    },
    storage: {
      local: {
        get: opts.get || (async (keys) => {
          const out = {};
          for (const k of [].concat(keys || [])) out[k] = localStore[k];
          return out;
        }),
        set: async (items) => Object.assign(localStore, items),
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
    __commandHandlers: commandHandlers,
  };
}

function loadSW(chrome) {
  const { buildSWScript } = require('./helpers/swBundle.js');
  const sandbox = {
    chrome,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    atob,
    btoa,
    Uint8Array,
    Promise,
    Map,
    Set,
    JSON,
    Date,
    Math,
    Error,
    Number,
    String,
    Boolean,
    Array,
    Object,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    undefined,
    self: null,
    importScripts: () => {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildSWScript(), sandbox, { filename: 'service-worker.js' });
  return sandbox;
}

const flush = () => new Promise((r) => setImmediate(r));

describe('SW i18n 装载契约', () => {
  it('importScripts 先加载四个 i18n 脚本，再加载业务脚本', () => {
    const { parseImportScriptsArgs } = require('./helpers/swBundle.js');
    const imports = parseImportScriptsArgs(swSource());
    assert.deepEqual(
      imports.slice(0, I18N_SCRIPTS.length),
      I18N_SCRIPTS,
      'i18n 必须在 importScripts 最前，否则后续脚本取词时全局取词器尚未建立',
    );
    const firstNonI18n = imports.findIndex((p) => !I18N_SCRIPTS.includes(p));
    assert.ok(firstNonI18n >= I18N_SCRIPTS.length, 'i18n 之前不得有业务脚本');
  });

  it('三个对外入口（消息 / 命令 / 启动）都等待就绪门', () => {
    const src = swSource();
    assert.match(src, /const i18nReady = /);
    assert.match(src, /function whenI18nReady\(\)/);
    assert.match(src, /whenI18nReady\(\)\s*\n\s*\.then\(\(\) => handleMessage/);
    assert.match(src, /onCommand\.addListener\(async \(command\) => \{\s*\n\s*await whenI18nReady\(\)/);
    assert.match(src, /await whenI18nReady\(\);\s*\n\s*await Storage\.migrateStaleTokenExpiryOnce\(\)/);
  });

  it('hydrate 完成前不派发消息，完成后按存储 locale 取词', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const chrome = makeChromeMock({
      get: async () => {
        await gate;
        return { 'aidevpush.locale': 'en' };
      },
    });
    const sandbox = loadSW(chrome);

    const seen = { fired: false, resp: null };
    chrome.__messageHandlers[0](
      { action: 'no-such-action' },
      {},
      (resp) => { seen.fired = true; seen.resp = resp; },
    );
    await flush();
    await flush();
    assert.equal(seen.fired, false, 'hydrate 未完成时不得先派发消息（否则按 zh-CN 默认值取词）');
    assert.equal(sandbox.AidevpushI18n.getLocale(), 'zh-CN');

    release();
    await flush();
    await flush();
    assert.equal(seen.fired, true, 'hydrate 完成后必须派发消息');
    assert.equal(sandbox.AidevpushI18n.getLocale(), 'en');
  });

  it('hydrate 失败不阻断业务：仍派发消息并回落默认语言', async () => {
    const chrome = makeChromeMock({
      get: async () => { throw new Error('storage unavailable'); },
    });
    const sandbox = loadSW(chrome);
    const seen = { fired: false };
    chrome.__messageHandlers[0]({ action: 'no-such-action' }, {}, () => { seen.fired = true; });
    await flush();
    await flush();
    assert.equal(seen.fired, true, 'i18n 读取失败不得吞掉消息响应');
    assert.equal(sandbox.AidevpushI18n.getLocale(), 'zh-CN');
  });
});
