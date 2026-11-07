'use strict';

/**
 * macOS Option(Alt) 组合字符回归（硬约束 41）。
 *
 * 真实 Mac 上 Option+X / Option+Z / Option+Shift+Z 的 e.key 是组合字符
 * （≈ / Ω / ¸），而 e.code 仍是 KeyX / KeyZ。页内兜底监听原先只看 e.key，
 * 导致所有默认 Alt 快捷键匹配失败（用户报障「快捷键都失效了」）。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// storage.js 模块级只读取 chrome.storage 能力，最小桩即可（与 shortcut-choice 单测一致）
global.chrome = global.chrome || {
  storage: {
    local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
  },
};

const Storage = require(path.join(__dirname, '..', 'lib', 'storage.js'));

function keydown(partial) {
  return {
    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key: '', code: '',
    ...partial,
  };
}

describe('matchShortcutKeydown：macOS Option 组合字符按物理键还原', () => {
  it('Option+X（e.key=≈）命中 Alt+X', () => {
    assert.equal(
      Storage.matchShortcutKeydown(keydown({ altKey: true, key: '≈', code: 'KeyX' }), 'Alt+X'),
      true,
    );
  });

  it('Option+Z（e.key=Ω）命中 Alt+Z', () => {
    assert.equal(
      Storage.matchShortcutKeydown(keydown({ altKey: true, key: 'Ω', code: 'KeyZ' }), 'Alt+Z'),
      true,
    );
  });

  it('Option+Shift+Z（e.key=¸）命中 Alt+Shift+Z', () => {
    assert.equal(
      Storage.matchShortcutKeydown(
        keydown({ altKey: true, shiftKey: true, key: '¸', code: 'KeyZ' }),
        'Alt+Shift+Z',
      ),
      true,
    );
  });

  it('命名键同样还原：Option+逗号（e.key=¯，code=Comma）', () => {
    assert.equal(
      Storage.matchShortcutKeydown(keydown({ altKey: true, key: '¯', code: 'Comma' }), 'Alt+Comma'),
      true,
    );
  });

  it('e.key 已是合法键名时不以物理键覆盖（避免非 US 布局误触）', () => {
    assert.equal(
      Storage.matchShortcutKeydown(keydown({ altKey: true, key: 'e', code: 'KeyZ' }), 'Alt+Z'),
      false,
    );
  });

  it('物理键不同则不命中', () => {
    assert.equal(
      Storage.matchShortcutKeydown(keydown({ altKey: true, key: '≈', code: 'KeyY' }), 'Alt+X'),
      false,
    );
  });
});

describe('shortcutKeyNameFromEvent / shortcutKeyNameFromCode', () => {
  it('e.key 无法识别时回退 e.code', () => {
    assert.equal(Storage.shortcutKeyNameFromEvent({ key: '≈', code: 'KeyX' }), 'X');
    assert.equal(Storage.shortcutKeyNameFromEvent({ key: 'Ω', code: 'KeyZ' }), 'Z');
    assert.equal(Storage.shortcutKeyNameFromEvent({ key: '¯', code: 'Comma' }), 'Comma');
    assert.equal(Storage.shortcutKeyNameFromEvent({ key: 'x', code: 'KeyQ' }), 'X');
  });

  it('物理键映射覆盖快捷键允许集', () => {
    assert.equal(Storage.shortcutKeyNameFromCode('KeyA'), 'A');
    assert.equal(Storage.shortcutKeyNameFromCode('Digit7'), '7');
    assert.equal(Storage.shortcutKeyNameFromCode('F12'), 'F12');
    assert.equal(Storage.shortcutKeyNameFromCode('ArrowUp'), 'Up');
    assert.equal(Storage.shortcutKeyNameFromCode('PageDown'), 'PageDown');
    assert.equal(Storage.shortcutKeyNameFromCode('Backquote'), 'Backquote');
    assert.equal(Storage.shortcutKeyNameFromCode('Enter'), '');
  });
});
