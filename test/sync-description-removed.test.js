'use strict';

/**
 * 下线「跨页面同步任务描述」：各标签页描述互相独立，无开关、无广播。
 */

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('跨页面任务描述同步已下线', () => {
  it('T1 Storage 不再提供 syncDescription 配置 API', () => {
    function createMemoryArea() {
      const data = {};
      return {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) {
            if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
          }
          return out;
        },
        async set(obj) { Object.assign(data, obj); },
        async remove() {},
      };
    }
    global.chrome = {
      storage: { local: createMemoryArea(), session: createMemoryArea() },
    };
    delete require.cache[require.resolve('../lib/storage.js')];
    const Storage = require('../lib/storage.js');
    assert.equal(typeof Storage.getSyncDescriptionConfig, 'undefined');
    assert.equal(typeof Storage.saveSyncDescriptionConfig, 'undefined');
  });

  it('T2 popup.html 无跨页同步开关', () => {
    const html = read('popup/popup.html');
    assert.doesNotMatch(html, /syncDescriptionToggle/);
    assert.doesNotMatch(html, /跨页面同步任务描述/);
  });

  it('T3 生产源码不再发送或处理 syncDescription', () => {
    const files = [
      'content/content.js',
      'popup/popup.js',
      'background/service-worker.js',
      'lib/storage.js',
    ];
    for (const rel of files) {
      const src = read(rel);
      assert.doesNotMatch(src, /syncDescription/, `${rel} 仍含 syncDescription`);
      assert.doesNotMatch(src, /getSyncDescriptionConfig/, `${rel} 仍含 getSyncDescriptionConfig`);
      assert.doesNotMatch(src, /setSyncDescriptionConfig/, `${rel} 仍含 setSyncDescriptionConfig`);
      assert.doesNotMatch(src, /setupDescSyncListener/, `${rel} 仍含 setupDescSyncListener`);
    }
  });

  it('T5 UserGuide 说明各标签页描述独立且无跨页同步文案', () => {
    const UserGuide = require('../lib/user-guide.js');
    const html = UserGuide.renderCollapsibleHtml({ surface: 'popup' });
    assert.match(html, /各标签页.*描述.*独立/);
    assert.doesNotMatch(html, /跨页面同步任务描述/);
    const md = read('docs/USER_GUIDE.md');
    assert.match(md, /各标签页.*描述.*独立/);
    assert.doesNotMatch(md, /跨页面同步任务描述/);
  });
});

describe('SW 旧版 syncDescription 不再转发', () => {
  function makeChromeMock() {
    const sent = [];
    const messageHandlers = [];
    return {
      webRequest: {
        onCompleted: { addListener: () => {} },
        onErrorOccurred: { addListener: () => {} },
      },
      webNavigation: { getAllFrames: async () => [] },
      tabs: {
        onActivated: { addListener: () => {} },
        onRemoved: { addListener: () => {} },
        onUpdated: { addListener: () => {} },
        onDiscarded: { addListener: () => {} },
        query: async () => [{ id: 1 }, { id: 2 }],
        sendMessage: async (tabId, message) => {
          sent.push({ tabId, message });
          return {};
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
      __sent: sent,
      __messageHandlers: messageHandlers,
    };
  }

  function loadSW(chrome) {
    const swSrc = fs.readFileSync(path.join(ROOT, 'background/service-worker.js'), 'utf8');
    const libDir = path.join(ROOT, 'lib');
    const libs = [];
    const swBody = swSrc.replace(/importScripts\(([\s\S]*?)\);/, (_, args) => {
      for (const p of args.match(/'[^']+'/g) || []) {
        const file = p.replace(/'/g, '').replace('../lib/', '');
        libs.push(fs.readFileSync(path.join(libDir, file), 'utf8'));
      }
      return '';
    });
    const sandbox = {
      chrome,
      console,
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
    };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(libs.join('\n') + '\n' + swBody, sandbox, { filename: 'service-worker.js' });
    return sandbox;
  }

  it('T4 旧版 syncDescription 不向其它标签页 sendMessage', async () => {
    const chrome = makeChromeMock();
    loadSW(chrome);
    const calls = { count: 0, resp: null };
    chrome.__messageHandlers[0](
      { action: 'syncDescription', description: 'leak', sourceUrl: 'https://example.test/' },
      { tab: { id: 1 } },
      (resp) => { calls.count++; calls.resp = resp; },
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(chrome.__sent.length, 0, '不得向其它 tab 转发描述');
    assert.equal(calls.count, 1);
    assert.match(String(calls.resp?.error || ''), /Unknown action/);
  });
});
