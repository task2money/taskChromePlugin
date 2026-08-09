'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contentJs = fs.readFileSync(
  path.join(__dirname, '..', 'content', 'content.js'),
  'utf8'
);

// content.js 为 IIFE 内容脚本（顶层立即操作 DOM），无法直接 require；
// 回归测试采用源码契约断言：修复后默认提示语必须来自 ElementPicker.DEFAULT_ADJUST_PROMPT，
// 且旧硬编码文案不得残留。修复前（硬编码 '请解决问题' 存在）断言 1 失败，可复现缺陷。
describe('content.js 调整期望输入框默认提示语', () => {
  it('不再硬编码旧文案「请解决问题」', () => {
    assert.ok(
      !contentJs.includes("'请解决问题'"),
      'content.js 不应残留旧默认提示语硬编码'
    );
  });

  it('默认提示语引用 ElementPicker.DEFAULT_ADJUST_PROMPT', () => {
    assert.ok(
      contentJs.includes('adjustInput.value = ElementPicker.DEFAULT_ADJUST_PROMPT'),
      'openAdjustModal 默认值应来自 ElementPicker.DEFAULT_ADJUST_PROMPT 常量'
    );
  });
});
