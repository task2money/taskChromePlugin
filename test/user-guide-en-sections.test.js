'use strict';

/**
 * 英文使用说明与侧边栏、直连 Key 文案保持一致。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'user-guide-en-sections.js'), 'utf8');

describe('user-guide-en-sections', () => {
  it('工具栏图标展开或收起侧边栏', () => {
    assert.match(src, /open or close that side panel/);
  });

  it('直连 Key 标明不上传且存在本机 LocalStorage', () => {
    assert.match(src, /not uploaded; stored in this browser LocalStorage/);
    assert.doesNotMatch(src, /\(free;/);
  });
});
