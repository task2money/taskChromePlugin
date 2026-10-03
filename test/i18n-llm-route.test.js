'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../lib/i18n-llm-route.js'), 'utf8');

describe('i18n-llm-route builtin refresh copy', () => {
  it('中英都有 paBuiltinRefreshing', () => {
    const zh = src.indexOf("paBuiltinRefreshing: '正在刷新内置模型状态…'");
    const en = src.indexOf("paBuiltinRefreshing: 'Refreshing on-device model status…'");
    assert.ok(zh > 0);
    assert.ok(en > zh);
  });
});
