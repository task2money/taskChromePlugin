'use strict';

/**
 * 设置页「固定到工具栏」：Chrome 只提供读取，扩展不能代为打开。
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
    assert.equal(view.statusKey, 'toolbarPinOn');
  });

  it('未固定时只读展示未打开', () => {
    const view = toolbarPinView({ isOnToolbar: false });
    assert.equal(view.pinned, false);
    assert.equal(view.writable, false);
    assert.equal(view.statusKey, 'toolbarPinOff');
  });

  it('读不到设置时不假装已打开', () => {
    const view = toolbarPinView(null);
    assert.equal(view.pinned, false);
    assert.equal(view.known, false);
    assert.equal(view.writable, false);
    assert.equal(view.statusKey, 'toolbarPinUnknown');
  });
});

describe('设置页不提供可写入的固定开关', () => {
  it('状态行在悬浮球区内，且没有可勾选的固定开关', () => {
    const html = read('popup/popup.html');
    const start = html.indexOf('id="toolbarPinSection"');
    const end = html.indexOf('id="pageAdvisorLlmSection"');
    const block = html.slice(start, end);
    assert.match(block, /id="toolbarPinStatus"/);
    assert.match(block, /data-i18n="toolbarPinLabel"/);
    assert.match(block, /data-i18n="toolbarPinHint"/);
    assert.match(block, /data-region-help="1"/);
    assert.doesNotMatch(block, /id="toolbarPinToggle"/);
    assert.doesNotMatch(block, /<input[^>]*toolbarPin/);
  });

  it('脚本只读取 getUserSettings，不调用写入接口', () => {
    const src = read('popup/popup-toolbar-pin.js');
    assert.match(src, /getUserSettings/);
    assert.doesNotMatch(src, /setUserSettings/);
    assert.doesNotMatch(src, /toolbar_pin/);
    assert.doesNotMatch(src, /\.pin\s*\(/);
  });
});
