'use strict';

/**
 * 元素拾取快捷键选择（⌘/Ctrl+Shift+X）— Storage 层运行时单测
 *
 * 覆盖：
 *  - detectOsShortcut：macOS → 'cmd'，Windows/Linux/无 navigator → 'ctrl'（默认按系统）
 *  - getElementPickerShortcut：未设置回退 OS 默认；非法存储值回退 OS 默认
 *  - saveElementPickerShortcut：合法值持久化；非法值归一化为 OS 默认
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

function createMemoryArea() {
  const data = {};
  return {
    _data: data,
    async get(keys) {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) {
        if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
      }
      return out;
    },
    async set(obj) {
      Object.assign(data, obj);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete data[k];
    },
  };
}

global.chrome = {
  storage: {
    local: createMemoryArea(),
    session: createMemoryArea(),
  },
};

const Storage = require('../lib/storage.js');

/** 模拟某操作系统的 navigator（userAgentData / platform / userAgent 三种形态）；须 await 保证异步 fn 期间 navigator 仍为 mock */
async function withNavigator(nav, fn) {
  const hadNav = Object.prototype.hasOwnProperty.call(globalThis, 'navigator');
  const prev = globalThis.navigator;
  try {
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
    return await fn();
  } finally {
    if (hadNav) {
      Object.defineProperty(globalThis, 'navigator', { value: prev, configurable: true });
    } else {
      delete globalThis.navigator;
    }
  }
}

describe('detectOsShortcut — 操作系统默认修饰键', () => {
  it('macOS 返回 cmd（⌘+Shift+X）', () => {
    assert.equal(Storage.detectOsShortcut({ userAgentData: { platform: 'macOS' } }), 'cmd');
    assert.equal(Storage.detectOsShortcut({ platform: 'MacIntel' }), 'cmd');
    assert.equal(
      Storage.detectOsShortcut({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }),
      'cmd',
    );
  });

  it('Windows / Linux 返回 ctrl（Ctrl+Shift+X）', () => {
    assert.equal(Storage.detectOsShortcut({ userAgentData: { platform: 'Windows' } }), 'ctrl');
    assert.equal(Storage.detectOsShortcut({ platform: 'Win32' }), 'ctrl');
    assert.equal(Storage.detectOsShortcut({ platform: 'Linux x86_64' }), 'ctrl');
    assert.equal(Storage.detectOsShortcut({ platform: 'ChromeOS' }), 'ctrl');
  });

  it('无 navigator（node 测试环境）回退 ctrl', () => {
    assert.equal(Storage.detectOsShortcut(null), 'ctrl');
    assert.equal(Storage.detectOsShortcut(undefined), 'ctrl');
  });
});

describe('getElementPickerShortcut — 读取配置', () => {
  beforeEach(async () => {
    // Storage._area 在 require 时捕获引用，须随区域重建一并重绑，否则读写落在旧区域
    global.chrome.storage.local = createMemoryArea();
    Storage._area = global.chrome.storage.local;
  });

  it('未设置时按操作系统默认（macOS → cmd）', async () => {
    await withNavigator({ platform: 'MacIntel' }, async () => {
      assert.equal(await Storage.getElementPickerShortcut(), 'cmd');
    });
  });

  it('未设置时按操作系统默认（Linux → ctrl）', async () => {
    await withNavigator({ platform: 'Linux x86_64' }, async () => {
      assert.equal(await Storage.getElementPickerShortcut(), 'ctrl');
    });
  });

  it('存储值为合法模式时原样返回', async () => {
    await global.chrome.storage.local.set({ elementPickerShortcut: 'cmd' });
    assert.equal(await Storage.getElementPickerShortcut(), 'cmd');
    await global.chrome.storage.local.set({ elementPickerShortcut: 'ctrl' });
    assert.equal(await Storage.getElementPickerShortcut(), 'ctrl');
  });

  it('存储值为非法模式时回退操作系统默认', async () => {
    await withNavigator({ platform: 'Linux x86_64' }, async () => {
      await global.chrome.storage.local.set({ elementPickerShortcut: 'alt' });
      assert.equal(await Storage.getElementPickerShortcut(), 'ctrl');
      await global.chrome.storage.local.set({ elementPickerShortcut: '' });
      assert.equal(await Storage.getElementPickerShortcut(), 'ctrl');
    });
    await withNavigator({ platform: 'MacIntel' }, async () => {
      await global.chrome.storage.local.set({ elementPickerShortcut: 'shift' });
      assert.equal(await Storage.getElementPickerShortcut(), 'cmd');
    });
  });
});

describe('saveElementPickerShortcut — 保存配置', () => {
  beforeEach(async () => {
    global.chrome.storage.local = createMemoryArea();
    Storage._area = global.chrome.storage.local;
  });

  it('合法模式持久化并可读回', async () => {
    assert.equal(await Storage.saveElementPickerShortcut('cmd'), 'cmd');
    assert.equal(await Storage.getElementPickerShortcut(), 'cmd');
    assert.equal(await Storage.saveElementPickerShortcut('ctrl'), 'ctrl');
    assert.equal(await Storage.getElementPickerShortcut(), 'ctrl');
  });

  it('非法模式归一化为操作系统默认并持久化', async () => {
    await withNavigator({ platform: 'Linux x86_64' }, async () => {
      assert.equal(await Storage.saveElementPickerShortcut('bogus'), 'ctrl');
      const stored = await global.chrome.storage.local.get(['elementPickerShortcut']);
      assert.equal(stored.elementPickerShortcut, 'ctrl');
    });
  });
});
