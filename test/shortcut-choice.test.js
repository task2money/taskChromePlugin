'use strict';

/**
 * 元素拾取快捷键（可自定义，默认 Alt+X）— Storage 层运行时单测
 *
 * 覆盖：
 *  - 默认值：无配置 / 非法值 → 'Alt+X'（全平台统一）
 *  - 旧版迁移：'cmd' → 'Command+Shift+X'，'ctrl' → 'Ctrl+Shift+X'（历史值，≠ 当前默认）
 *  - normalizeShortcut：格式归一化 + 非法组合拒绝（对齐 chrome.commands 规范）
 *  - shortcutToPlatformBinding：macOS 上 Ctrl → MacCtrl（字面 Control 键）
 *  - matchShortcutKeydown：严格修饰键 + 按键匹配（未列出的修饰键不得按下）
 */

const { describe, it, beforeEach } = require('node:test');
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

const memArea = createMemoryArea();
global.chrome = { storage: { local: memArea, session: createMemoryArea() } };

const Storage = require('../lib/storage.js');

beforeEach(() => {
  for (const k of Object.keys(memArea._data)) delete memArea._data[k];
});

/** 模拟某操作系统的 navigator（userAgentData / platform / userAgent 三种形态） */
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

const NAV_MAC = { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const NAV_WIN = { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const NAV_LINUX = { platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' };
/** 新版 UA-CH（userAgentData.platform）形态：macOS / Windows / Linux */
const NAV_UAD_MAC = { userAgentData: { platform: 'macOS' }, userAgent: 'Mozilla/5.0 (Macintosh)' };
const NAV_UAD_WIN = { userAgentData: { platform: 'Windows' }, userAgent: 'Mozilla/5.0 (Windows NT 10.0)' };
const NAV_UAD_LINUX = { userAgentData: { platform: 'Linux' }, userAgent: 'Mozilla/5.0 (X11; Linux)' };

/** 构造 keydown 事件对象（仅含匹配所需字段） */
function keydown(partial) {
  return {
    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key: '',
    ...partial,
  };
}

describe('元素拾取快捷键（默认统一 Alt+X）', () => {
  describe('detectDefaultShortcut / isMacPlatform', () => {
    it('全平台 → Alt+X；isMacPlatform 仍按 OS 探测（改绑 MacCtrl 用）', async () => {
      await withNavigator(NAV_MAC, async () => {
        assert.equal(Storage.detectDefaultShortcut(), 'Alt+X');
        assert.equal(Storage.isMacPlatform(), true);
      });
      await withNavigator(NAV_WIN, async () => {
        assert.equal(Storage.detectDefaultShortcut(), 'Alt+X');
        assert.equal(Storage.isMacPlatform(), false);
      });
      await withNavigator(NAV_LINUX, async () => {
        assert.equal(Storage.detectDefaultShortcut(), 'Alt+X');
        assert.equal(Storage.isMacPlatform(), false);
      });
      await withNavigator(undefined, async () => {
        assert.equal(Storage.detectDefaultShortcut(), 'Alt+X');
      });
    });

    it('userAgentData.platform（UA-CH）形态：默认仍 Alt+X，mac 探测正确', async () => {
      await withNavigator(NAV_UAD_MAC, async () => {
        assert.equal(Storage.detectDefaultShortcut(), 'Alt+X');
        assert.equal(Storage.isMacPlatform(), true);
      });
      await withNavigator(NAV_UAD_WIN, async () => {
        assert.equal(Storage.detectDefaultShortcut(), 'Alt+X');
        assert.equal(Storage.isMacPlatform(), false);
      });
      await withNavigator(NAV_UAD_LINUX, async () => {
        assert.equal(Storage.detectDefaultShortcut(), 'Alt+X');
        assert.equal(Storage.isMacPlatform(), false);
      });
    });
  });

  describe('getElementPickerShortcut', () => {
    it('无配置时回退统一默认 Alt+X（与 OS 无关）', async () => {
      await withNavigator(NAV_MAC, async () => {
        assert.equal(await Storage.getElementPickerShortcut(), 'Alt+X');
      });
      await withNavigator(NAV_WIN, async () => {
        assert.equal(await Storage.getElementPickerShortcut(), 'Alt+X');
      });
      await withNavigator(NAV_LINUX, async () => {
        assert.equal(await Storage.getElementPickerShortcut(), 'Alt+X');
      });
    });

    it('旧版 cmd 模式迁移为 Command+Shift+X', async () => {
      await chrome.storage.local.set({ elementPickerShortcut: 'cmd' });
      assert.equal(await Storage.getElementPickerShortcut(), 'Command+Shift+X');
    });

    it('旧版 ctrl 模式迁移为 Ctrl+Shift+X（历史值，≠ SHORTCUT_DEFAULT）', async () => {
      await chrome.storage.local.set({ elementPickerShortcut: 'ctrl' });
      assert.equal(await Storage.getElementPickerShortcut(), 'Ctrl+Shift+X');
      assert.equal(Storage.SHORTCUT_DEFAULT, 'Alt+X');
    });

    it('已保存的规范组合原样返回', async () => {
      await chrome.storage.local.set({ elementPickerShortcut: 'Alt+Shift+E' });
      assert.equal(await Storage.getElementPickerShortcut(), 'Alt+Shift+E');
    });

    it('非法存储值回退统一默认 Alt+X', async () => {
      for (const bad of [42, null, '', 'Shift+X', 'Ctrl+Enter']) {
        await chrome.storage.local.set({ elementPickerShortcut: bad });
        await withNavigator(NAV_WIN, async () => {
          assert.equal(await Storage.getElementPickerShortcut(), 'Alt+X', `非法值 ${JSON.stringify(bad)} 应回退 Alt+X`);
        });
        await withNavigator(NAV_MAC, async () => {
          assert.equal(await Storage.getElementPickerShortcut(), 'Alt+X', `非法值 ${JSON.stringify(bad)} 应回退 Alt+X`);
        });
      }
    });
  });

  describe('normalizeShortcut', () => {
    it('归一化大小写与空格：alt+x → Alt+X', () => {
      assert.equal(Storage.normalizeShortcut('alt+x'), 'Alt+X');
      assert.equal(Storage.normalizeShortcut('alt+shift+x'), 'Alt+Shift+X');
      assert.equal(Storage.normalizeShortcut(' Ctrl + Shift + X '), 'Ctrl+Shift+X');
    });

    it('接受合法组合样例', () => {
      for (const ok of [
        'Alt+X', 'Ctrl+Shift+X', 'Alt+Shift+E', 'Ctrl+1', 'Ctrl+Shift+Comma',
        'Ctrl+Shift+Period', 'Ctrl+Space', 'Alt+Shift+Up', 'Ctrl+Shift+PageDown',
        'Command+Shift+X', 'Ctrl+Insert', 'Ctrl+Shift+Delete', 'Ctrl+Home',
        'Ctrl+Shift+End', 'Ctrl+Shift+F5', 'Alt+F12',
      ]) {
        assert.equal(Storage.normalizeShortcut(ok), ok, ok);
      }
    });

    it('拒绝非法组合', () => {
      for (const bad of ['Meta+X', 'Super+X', 'Ctrl+Enter', 'Ctrl+Tab', 'Ctrl+Escape', 'Ctrl+Alt+Shift+X', 'Ctrl+Shift+Shift+X']) {
        assert.equal(Storage.normalizeShortcut(bad), null, bad);
      }
    });
  });

  describe('saveElementPickerShortcut', () => {
    it('保存合法组合并可读回', async () => {
      const saved = await Storage.saveElementPickerShortcut('Alt+Shift+E');
      assert.equal(saved, 'Alt+Shift+E');
      assert.equal(await Storage.getElementPickerShortcut(), 'Alt+Shift+E');
    });

    it('非法组合抛错且不落盘', async () => {
      await assert.rejects(() => Storage.saveElementPickerShortcut('Shift+X'));
      const cfg = await chrome.storage.local.get(['elementPickerShortcut']);
      assert.equal(cfg.elementPickerShortcut, undefined);
    });
  });

  describe('shortcutToPlatformBinding', () => {
    it('非 mac：原样返回', () => {
      assert.equal(Storage.shortcutToPlatformBinding('Alt+X', false), 'Alt+X');
      assert.equal(Storage.shortcutToPlatformBinding('Ctrl+Shift+X', false), 'Ctrl+Shift+X');
      assert.equal(Storage.shortcutToPlatformBinding('Alt+Shift+E', false), 'Alt+Shift+E');
    });

    it('mac：Ctrl → MacCtrl；Alt/Command 不变', () => {
      assert.equal(Storage.shortcutToPlatformBinding('Ctrl+Shift+X', true), 'MacCtrl+Shift+X');
      assert.equal(Storage.shortcutToPlatformBinding('Alt+X', true), 'Alt+X');
      assert.equal(Storage.shortcutToPlatformBinding('Command+Shift+X', true), 'Command+Shift+X');
      assert.equal(Storage.shortcutToPlatformBinding('Alt+Shift+E', true), 'Alt+Shift+E');
    });
  });

  describe('matchShortcutKeydown', () => {
    it('Alt+X：仅 alt+x 命中', () => {
      assert.equal(Storage.matchShortcutKeydown(keydown({ altKey: true, key: 'x' }), 'Alt+X'), true);
      assert.equal(Storage.matchShortcutKeydown(keydown({ altKey: true, key: 'X' }), 'Alt+X'), true);
      assert.equal(Storage.matchShortcutKeydown(keydown({ altKey: true, shiftKey: true, key: 'x' }), 'Alt+X'), false, '多余 Shift');
      assert.equal(Storage.matchShortcutKeydown(keydown({ ctrlKey: true, key: 'x' }), 'Alt+X'), false);
    });

    it('Ctrl+Shift+X：ctrl+shift+x 命中，缺 Shift / 带 Meta 不命中', () => {
      assert.equal(Storage.matchShortcutKeydown(keydown({ ctrlKey: true, shiftKey: true, key: 'x' }), 'Ctrl+Shift+X'), true);
      assert.equal(Storage.matchShortcutKeydown(keydown({ ctrlKey: true, shiftKey: true, key: 'X' }), 'Ctrl+Shift+X'), true);
      assert.equal(Storage.matchShortcutKeydown(keydown({ ctrlKey: true, key: 'x' }), 'Ctrl+Shift+X'), false, '缺 Shift');
      assert.equal(Storage.matchShortcutKeydown(keydown({ ctrlKey: true, shiftKey: true, metaKey: true, key: 'x' }), 'Ctrl+Shift+X'), false, '多余 Meta');
      assert.equal(Storage.matchShortcutKeydown(keydown({ metaKey: true, shiftKey: true, key: 'x' }), 'Ctrl+Shift+X'), false, '用 Command 不命中 Ctrl');
    });

    it('Command+Shift+X：meta+shift+x 命中', () => {
      assert.equal(Storage.matchShortcutKeydown(keydown({ metaKey: true, shiftKey: true, key: 'x' }), 'Command+Shift+X'), true);
      assert.equal(Storage.matchShortcutKeydown(keydown({ ctrlKey: true, shiftKey: true, key: 'x' }), 'Command+Shift+X'), false);
    });

    it('Alt+Shift+E：alt+shift+e 命中，其他键不命中', () => {
      assert.equal(Storage.matchShortcutKeydown(keydown({ altKey: true, shiftKey: true, key: 'e' }), 'Alt+Shift+E'), true);
      assert.equal(Storage.matchShortcutKeydown(keydown({ altKey: true, shiftKey: true, key: 'x' }), 'Alt+Shift+E'), false);
    });

    it('空事件不命中', () => {
      assert.equal(Storage.matchShortcutKeydown(null, 'Alt+X'), false);
      assert.equal(Storage.matchShortcutKeydown(null, 'Ctrl+Shift+X'), false);
    });
  });
});
