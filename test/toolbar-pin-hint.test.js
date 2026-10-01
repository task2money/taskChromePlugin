'use strict';

/**
 * 浮窗一次性提示：未固定才出现，关闭后不再出现。扩展不能写入固定状态。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { shouldShowToolbarPinPageHint } = require('../lib/toolbar-pin-hint.js');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('shouldShowToolbarPinPageHint', () => {
  it('未固定且未关闭过时展示', () => {
    assert.equal(shouldShowToolbarPinPageHint({
      known: true,
      pinned: false,
      dismissed: false,
    }), true);
  });

  it('已固定时不展示', () => {
    assert.equal(shouldShowToolbarPinPageHint({
      known: true,
      pinned: true,
      dismissed: false,
    }), false);
  });

  it('关闭过不再展示', () => {
    assert.equal(shouldShowToolbarPinPageHint({
      known: true,
      pinned: false,
      dismissed: true,
    }), false);
  });

  it('读不到设置时不展示', () => {
    assert.equal(shouldShowToolbarPinPageHint({
      known: false,
      pinned: false,
      dismissed: false,
    }), false);
  });
});

describe('浮窗经 service worker 只读查询，不轮询', () => {
  it('content 脚本不直接调用 getUserSettings', () => {
    const src = read('content/float-toolbar-pin-hint.js');
    assert.match(src, /getToolbarPin/);
    assert.match(src, /chrome\.storage\.local\.set/);
    assert.doesNotMatch(src, /getUserSettings/);
    assert.doesNotMatch(src, /setInterval/);
    assert.doesNotMatch(src, /setUserSettings/);
    assert.doesNotMatch(src, /\.pin\s*\(/);
  });

  it('service worker 只读取 getUserSettings', () => {
    const src = read('background/sw-messages-session.js');
    assert.match(src, /case 'getToolbarPin'/);
    assert.match(src, /getUserSettings/);
    assert.doesNotMatch(src, /setUserSettings/);
    assert.doesNotMatch(src, /toolbar_pin/);
  });
});
