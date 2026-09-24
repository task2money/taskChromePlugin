'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('i18n-hardware-stock-messages', () => {
  it('错误条关闭按钮有中英文案', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../lib/i18n-hardware-stock-messages.js'),
      'utf8',
    );
    assert.match(src, /floatDismissResult:\s*'关闭提示'/);
    assert.match(src, /floatDismissResult:\s*'Dismiss notice'/);
  });
});
