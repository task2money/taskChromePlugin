'use strict';

/**
 * 下线登录/快捷键/过期的跨 tab 扇出；选元素仅同 tab 子 frame。
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

describe('跨 tab 扇出已下线', () => {
  it('T1 SW 不再 query 全部标签页，无三类广播函数', () => {
    const sw = read('background/service-worker.js');
    assert.doesNotMatch(sw, /chrome\.tabs\.query\(\{\}\)/);
    assert.doesNotMatch(sw, /function broadcastAuthStateChanged/);
    assert.doesNotMatch(sw, /function broadcastElementPickerShortcut/);
    assert.doesNotMatch(sw, /function broadcastAccountExpired/);
  });

  it('T2 Popup 不再向全部标签页发 authStateChanged', () => {
    const popup = read('popup/popup.js');
    assert.doesNotMatch(popup, /notifyContentScriptsAuthChanged/);
    assert.doesNotMatch(popup, /action: 'authStateChanged'/);
  });

  it('T7 Popup 悬浮球开关不再向全部标签页 sendMessage (OPT-20260821-008)', () => {
    const popup = read('popup/popup.js');
    const start = popup.indexOf('悬浮球开关');
    const end = popup.indexOf('跟踪开关');
    const seg = popup.slice(start, end === -1 ? popup.length : end);
    assert.doesNotMatch(seg, /chrome\.tabs\.query\(\{\}\)/);
    assert.doesNotMatch(seg, /setFloatBallEnabled/);
  });

  it('T8 content 监听 floatBallEnabled storage 变更自更新 (OPT-20260821-008)', () => {
    const { readContentBundle } = require('./helpers/contentBundle.js');
    const content = readContentBundle();
    assert.match(content, /function bindStorageListeners/);
    assert.match(content, /changes\.floatBallEnabled/);
  });

  it('T5 选元素仍按当前 tab 广播子 frame', () => {
    const sw = read('background/service-worker.js');
    assert.match(sw, /function broadcastPickToChildFrames/);
    assert.match(sw, /case 'broadcastStartElementPick'/);
  });

  it('T6 UserGuide 说明登录/快捷键不跨 tab 扇出', () => {
    const UserGuide = require('../lib/user-guide.js');
    const html = UserGuide.renderCollapsibleHtml({ surface: 'popup' });
    assert.match(html, /不向其它标签页广播|不跨标签页扇出|storage 变更/);
    const md = read('docs/USER_GUIDE.md');
    assert.match(md, /不向其它标签页广播|不跨标签页扇出|storage 变更/);
  });
});

describe('SW 登录与快捷键不扇出其它 tab', () => {
  function makeChromeMock() {
    const sent = [];
    const messageHandlers = [];
    const localStore = {};
    return {
      webRequest: {
        onCompleted: { addListener: () => {} },
        onErrorOccurred: { addListener: () => {} },
      },
      webNavigation: { getAllFrames: async () => [{ frameId: 0 }, { frameId: 1 }] },
      tabs: {
        onActivated: { addListener: () => {} },
        onRemoved: { addListener: () => {} },
        onUpdated: { addListener: () => {} },
        onDiscarded: { addListener: () => {} },
        query: async (q) => {
          if (q && Object.keys(q).length === 0) {
            return [{ id: 1 }, { id: 2 }, { id: 3 }];
          }
          return [{ id: 9 }];
        },
        sendMessage: async (tabId, message, sendOpts) => {
          sent.push({ tabId, message, opts: sendOpts || null });
          return { success: true };
        },
      },
      action: {
        setBadgeText: async () => {},
        setBadgeBackgroundColor: async () => {},
      },
      commands: {
        update: async () => {},
        getAll: async () => [],
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
            for (const k of [].concat(keys || [])) out[k] = localStore[k];
            return out;
          },
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
      __sent: sent,
      __messageHandlers: messageHandlers,
    };
  }

  function loadSW(chrome) {
    const swSrc = read('background/service-worker.js');
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
      fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(libs.join('\n') + '\n' + swBody, sandbox, { filename: 'service-worker.js' });
    return sandbox;
  }

  const flush = () => new Promise((r) => setImmediate(r));

  function invoke(chrome, message, sender) {
    const calls = { count: 0, resp: null };
    chrome.__messageHandlers[0](message, sender || {}, (resp) => {
      calls.count++;
      calls.resp = resp;
    });
    return calls;
  }

  it('T3 setElementPickerShortcut 不向其它标签页 sendMessage', async () => {
    const chrome = makeChromeMock();
    loadSW(chrome);
    const calls = invoke(chrome, { action: 'setElementPickerShortcut', shortcut: 'Alt+Shift+E' });
    await flush();
    await flush();
    assert.equal(calls.count, 1);
    assert.equal(calls.resp.success, true);
    assert.equal(chrome.__sent.length, 0, '快捷键不得跨 tab 广播');
  });

  it('T4 logout 不向其它标签页发 authStateChanged', async () => {
    const chrome = makeChromeMock();
    loadSW(chrome);
    const calls = invoke(chrome, { action: 'logout' });
    await flush();
    await flush();
    assert.equal(calls.count, 1);
    assert.equal(calls.resp.success, true);
    const authMsgs = chrome.__sent.filter((s) => s.message && s.message.action === 'authStateChanged');
    assert.equal(authMsgs.length, 0);
  });

  it('T5 broadcastStartElementPick 只发给同一 tab 的子 frame', async () => {
    const chrome = makeChromeMock();
    loadSW(chrome);
    const calls = invoke(chrome, { action: 'broadcastStartElementPick', source: 'float' }, { tab: { id: 5 } });
    await flush();
    await flush();
    assert.equal(calls.count, 1);
    assert.equal(calls.resp.success, true);
    assert.ok(chrome.__sent.length >= 1);
    for (const s of chrome.__sent) {
      assert.equal(s.tabId, 5, '选元素不得发到其它 tab');
      assert.notEqual(s.opts && s.opts.frameId, 0);
    }
  });
});
