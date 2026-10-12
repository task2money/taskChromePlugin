'use strict';

/**
 * 侧栏选中项的浅金底不能被文字自己的白底盖住。
 * 通配层给每个 span 铺画布色，选项文字必须再改回透明。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../popup/popup-sidepanel.css'), 'utf8');

describe('侧栏选项文字', () => {
  it('选项文字背景透明，选中项仍用浅金底', () => {
    assert.match(
      css,
      /\.llm-route-option :is\(span, a\)\s*\{[^}]*background:\s*transparent\s*!important/,
    );
    assert.match(css, /:has\(input:checked\)[\s\S]*background:\s*var\(--taskplugin-accent-muted\)\s*!important/);
  });
});
