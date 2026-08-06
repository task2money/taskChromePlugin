'use strict';

/**
 * 元素拾取快捷键（可自定义，默认 Ctrl+Shift+X）— Storage 层运行时单测
 *
 * 覆盖：
 *  - 默认值：无配置 / 非法值 → 'Ctrl+Shift+X'（统一默认，与操作系统无关）
 *  - 旧版迁移：'cmd' → 'Command+Shift+X'，'ctrl' → 'Ctrl+Shift+X'
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

/** 构造 keydown 事件对象（仅含匹配所需字段） */
function keydown(partial) {
  return {
    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key: '',
    ...partial,
  };
}

describe('元素拾取快捷键（默认 Ctrl+Shift+X）', () => {
  describe('getElementPickerShortcut', () => {
    it('无配置时返回默认 Ctrl+Shift+X（不依赖操作系统）', async () => {
      assert.equal(await Storage.getElementPickerShortcut(), 'Ctrl+Shift+X');
    });

    it('旧版 cmd 模式迁移为 Command+Shift+X', async () => {
      await chrome.storage.local.set({ elementPickerShortcut: 'cmd' });
      assert.equal(await Storage.getElementPickerShortcut(), 'Command+Shift+X');
    });

    it('旧版 ctrl 模式迁移为 Ctrl+Shift+X', async () => {
      await chrome.storage.local.set({ elementPickerShortcut: 'ctrl' });
      assert.equal(await Storage.getElementPickerShortcut(), 'Ctrl+Shift+X');
    });

    it('已保存的规范组合原样返回', async () => {
      await chrome.storage.local.set({ elementPickerShortcut: 'Alt+Shift+E' });
      assert.equal(await Storage.getElementPickerShortcut(), 'Alt+Shift+E');
    });

    it('非法存储值回退默认', async () => {
      for (const bad of [42, null, '', 'Shift+X', 'Ctrl+Enter']) {
        await chrome.storage.local.set({ elementPickerShortcut: bad });
        assert.equal(await Storage.getElementPickerShortcut(), 'Ctrl+Shift+X', `非法值 ${JSON.stringify(bad)} 应回退默认`);
      }
    });
  });

  describe('normalizeShortcut', () => {
    it('归一化大小写与空格：alt+shift+x → Alt+Shift+X', () => {
      assert.equal(Storage.normalizeShortcut('alt+shift+x'), 'Alt+Shift+X');
      assert.equal(Storage.normalizeShortcut(' Ctrl + Shift + X '), 'Ctrl+Shift+X');
    });

    it('允许字母/数字/Comma/Period/Space/方向键/PageUp/PageDown/Insert/Delete/Home/End/F1-F12', () => {
      for (const ok of [
        'Ctrl+Shift+X', 'Alt+Shift+E', 'Ctrl+1', 'Ctrl+Shift+Comma',
        'Ctrl+Shift+Period', 'Ctrl+Space', 'Alt+Shift+Up', 'Ctrl+Shift+PageDown',
        'Command+Shift+X', 'Ctrl+Insert', 'Ctrl+Shift+Delete', 'Ctrl+Home',
        'Ctrl+Shift+End', 'Ctrl+Shift+F5', 'Alt+F12',
      ]) {
        assert.equal(Storage.normalizeShortcut(ok), ok, `合法组合应原样归一: ${ok}`);
      }
    });

    it('拒绝缺少主修饰键（Shift 不能单独作主修饰键）', () => {
      assert.equal(Storage.normalizeShortcut('Shift+X'), null);
      assert.equal(Storage.normalizeShortcut('X'), null);
    });

    it('拒绝仅修饰键 / 重复修饰键', () => {
      assert.equal(Storage.normalizeShortcut('Ctrl+Shift'), null);
      assert.equal(Storage.normalizeShortcut('Ctrl+Ctrl+X'), null);
    });

    it('拒绝未知修饰键与非法按键（Tab/Esc/Enter/裸修饰键）', () => {
      for (const bad of ['Meta+X', 'Super+X', 'Ctrl+Enter', 'Ctrl+Tab', 'Ctrl+Escape', 'Ctrl+Alt+Shift+X', 'Ctrl+Shift+Shift+X']) {
        assert.equal(Storage.normalizeShortcut(bad), null, `非法组合应拒绝: ${bad}`);
      }
    });

    it('拒绝非字符串与空值', () => {
      assert.equal(Storage.normalizeShortcut(null), null);
      assert.equal(Storage.normalizeShortcut(undefined), null);
      assert.equal(Storage.normalizeShortcut(42), null);
      assert.equal(Storage.normalizeShortcut(''), null);
    });
  });

  describe('saveElementPickerShortcut', () => {
    it('保存规范组合并持久化', async () => {
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
    it('非 macOS 平台原样返回', () => {
      assert.equal(Storage.shortcutToPlatformBinding('Ctrl+Shift+X', false), 'Ctrl+Shift+X');
      assert.equal(Storage.shortcutToPlatformBinding('Alt+Shift+E', false), 'Alt+Shift+E');
    });

    it('macOS 上 Ctrl → MacCtrl（字面 Control，避免被 Chrome 转换为 Command）', () => {
      assert.equal(Storage.shortcutToPlatformBinding('Ctrl+Shift+X', true), 'MacCtrl+Shift+X');
    });

    it('macOS 上 Command/Alt 组合保持不变', () => {
      assert.equal(Storage.shortcutToPlatformBinding('Command+Shift+X', true), 'Command+Shift+X');
      assert.equal(Storage.shortcutToPlatformBinding('Alt+Shift+E', true), 'Alt+Shift+E');
    });

    it('非法输入返回 null', () => {
      assert.equal(Storage.shortcutToPlatformBinding('Shift+X', false), null);
      assert.equal(Storage.shortcutToPlatformBinding(null, false), null);
    });
  });

  describe('matchShortcutKeydown（页内兜底严格匹配）', () => {
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

    it('特殊按键名映射（Space/方向键/Comma/Period）', () => {
      assert.equal(Storage.matchShortcutKeydown(keydown({ ctrlKey: true, key: ' ' }), 'Ctrl+Space'), true);
      assert.equal(Storage.matchShortcutKeydown(keydown({ ctrlKey: true, key: 'ArrowUp' }), 'Ctrl+Up'), true);
      assert.equal(Storage.matchShortcutKeydown(keydown({ ctrlKey: true, shiftKey: true, key: ',' }), 'Ctrl+Shift+Comma'), true);
      assert.equal(Storage.matchShortcutKeydown(keydown({ ctrlKey: true, shiftKey: true, key: '.' }), 'Ctrl+Shift+Period'), true);
    });

    it('非法组合 / 空输入返回 false', () => {
      assert.equal(Storage.matchShortcutKeydown(keydown({ ctrlKey: true, shiftKey: true, key: 'x' }), 'Shift+X'), false);
      assert.equal(Storage.matchShortcutKeydown(null, 'Ctrl+Shift+X'), false);
    });
  });
});
