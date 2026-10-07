'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('英文使用说明写明关掉弹窗会中断启用', () => {
  const en = fs.readFileSync(path.join(__dirname, '../lib/user-guide-en-sections.js'), 'utf8');
  assert.match(en, /Closing the popup aborts that enable/);
  assert.match(en, /each option is vendor remark\*model/);
});

test('英文使用说明：IDE 送达不在生成后自动转发', () => {
  const en = fs.readFileSync(path.join(__dirname, '../lib/user-guide-en-sections.js'), 'utf8');
  assert.match(en, /do not auto-send after generation/);
  assert.match(en, /click Send to/);
});
