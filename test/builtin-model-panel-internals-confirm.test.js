'use strict';

/**
 * 侧栏 on-device-internals 链接：进入可改坏本机模型的页面前须先确认（行为测）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function makeEl() {
  return {
    hidden: false,
    textContent: '',
    disabled: false,
    _on: {},
    addEventListener(type, fn) { this._on[type] = fn; },
    setAttribute() {},
    removeAttribute() {},
    click() {
      const fn = this._on.click;
      return fn ? fn() : undefined;
    },
  };
}

function loadPanel(opts) {
  const internals = makeEl();
  const els = {
    '#spBuiltinInternalsLink': internals,
    '#sp-tab-builtin': makeEl(),
  };
  const opened = [];
  const confirmCalls = [];
  const context = {
    console,
    OpenChromeUrl: {
      ON_DEVICE_INTERNALS: 'chrome://on-device-internals',
      openChromeUrl(url) {
        opened.push(url);
        return Promise.resolve();
      },
    },
    confirm(message) {
      confirmCalls.push(message);
      return opts.confirmResult;
    },
    tx(key) {
      if (key === 'paBuiltinOnDeviceInternalsCaution') {
        return '。请谨慎修改其中参数；搞错后可能无法再使用本机模型。';
      }
      return key;
    },
    document: {
      readyState: 'complete',
      addEventListener() {},
      querySelector: (sel) => els[sel] || null,
    },
    chrome: {
      storage: {
        onChanged: {
          addListener() {},
          removeListener() {},
        },
      },
    },
  };
  context.globalThis = context;
  const prevChrome = globalThis.chrome;
  globalThis.chrome = context.chrome;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'sidepanel/builtin-model-panel.js'), 'utf8'),
    context,
  );
  globalThis.chrome = prevChrome;
  return { internals, opened, confirmCalls };
}

test('点击 internals 链接：确认后才打开 on-device-internals', () => {
  const { internals, opened, confirmCalls } = loadPanel({ confirmResult: true });
  internals.click();
  assert.equal(confirmCalls.length, 1, '必须先弹出确认');
  assert.match(confirmCalls[0], /谨慎修改/);
  assert.deepEqual(opened, ['chrome://on-device-internals']);
});

test('点击 internals 链接：取消则不打开', () => {
  const { internals, opened } = loadPanel({ confirmResult: false });
  internals.click();
  assert.deepEqual(opened, [], '取消后不得调用 openChromeUrl');
});
