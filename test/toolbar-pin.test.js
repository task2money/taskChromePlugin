'use strict';

/**
 * 设置页不再展示「固定到工具栏」只读栏。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { toolbarPinView } = require('../lib/toolbar-pin.js');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('toolbarPinView', () => {
  it('已固定时只读展示已打开', () => {
    const view = toolbarPinView({ isOnToolbar: true });
    assert.equal(view.pinned, true);
    assert.equal(view.known, true);
    assert.equal(view.writable, false);
  });

  it('未固定时只读展示未打开', () => {
    const view = toolbarPinView({ isOnToolbar: false });
    assert.equal(view.pinned, false);
    assert.equal(view.writable, false);
  });

  it('读不到设置时不假装已打开', () => {
    const view = toolbarPinView(null);
    assert.equal(view.pinned, false);
    assert.equal(view.known, false);
    assert.equal(view.writable, false);
  });

  it('不再返回已无 UI 的 statusKey / badgeClass 死字段', () => {
    for (const settings of [{ isOnToolbar: true }, { isOnToolbar: false }, null]) {
      const view = toolbarPinView(settings);
      assert.equal(Object.prototype.hasOwnProperty.call(view, 'statusKey'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(view, 'badgeClass'), false);
    }
  });
});

describe('设置页不再展示固定到工具栏栏', () => {
  it('popup.html 无 toolbarPin 区块与开关', () => {
    const html = read('popup/popup.html');
    assert.doesNotMatch(html, /id="toolbarPinSection"/);
    assert.doesNotMatch(html, /id="toolbarPinStatus"/);
    assert.doesNotMatch(html, /id="toolbarPinToggle"/);
    assert.doesNotMatch(html, /data-i18n="toolbarPinLabel"/);
    assert.doesNotMatch(html, /popup-toolbar-pin\.js/);
    assert.equal(fs.existsSync(path.join(ROOT, 'popup/popup-toolbar-pin.js')), false);
  });
});
