'use strict';

/**
 * chrome.commands 展示串归一化回归（硬约束 41）。
 *
 * macOS 上 chrome.commands.getAll() 返回符号化展示串（⌥Z / ⌥⇧Z / ⌥`），
 * 旧代码直接与 "Alt+E" 比较，导致 Alt+E / Alt+` 旧绑定在 Mac 上永远迁移不到
 * 新的 Alt+Z / Alt+Shift+Z。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = path.join(__dirname, '..', 'background', 'sw-page-advisor-commands.js');

function loadNormalizer() {
  const context = { chrome: {}, console, Set, Array, String, Object };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(SOURCE, 'utf8'), context, { filename: SOURCE });
  return context.normalizeChromeCommandDisplay;
}

describe('normalizeChromeCommandDisplay：macOS 符号展示串 → 规范串', () => {
  const normalize = loadNormalizer();

  it('⌥Z / ⌥⇧Z 还原为 Alt+Z / Alt+Shift+Z', () => {
    assert.equal(normalize('⌥Z'), 'Alt+Z');
    assert.equal(normalize('⌥⇧Z'), 'Alt+Shift+Z');
  });

  it('旧版 Alt+E 系展示串可被识别（迁移条件命中）', () => {
    assert.equal(normalize('⌥E'), 'Alt+E');
    assert.equal(normalize('⌥⇧E'), 'Alt+Shift+E');
    assert.equal(normalize('⌥`'), 'Alt+Backquote');
    assert.equal(normalize('⌥⇧`'), 'Alt+Shift+Backquote');
  });

  it('非符号串原样返回；空串保持空', () => {
    assert.equal(normalize('Alt+Shift+E'), 'Alt+Shift+E');
    assert.equal(normalize('Ctrl+Shift+Y'), 'Ctrl+Shift+Y');
    assert.equal(normalize(''), '');
    assert.equal(normalize(null), '');
  });

  it('其余 macOS 修饰键符号也能还原', () => {
    assert.equal(normalize('⌃⌥⇧⌘X'), 'Ctrl+Alt+Shift+Command+X');
  });
});
