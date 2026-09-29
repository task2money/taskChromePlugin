'use strict';

/**
 * 元素高亮框样式在独立脚本里，且必须先于选元素逻辑注入。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

describe('float-pick-highlight', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'content', 'float-pick-highlight.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

  it('悬停高亮使用 taskplugin-el-highlight 描边', () => {
    assert.match(src, /taskplugin-el-highlight/);
    assert.match(src, /outline:2px solid #89b4fa/);
    assert.match(src, /function applyHighlightMany/);
  });

  it('在 float-pick.js 之前注入', () => {
    const js = manifest.content_scripts[0].js;
    const highlight = js.indexOf('content/float-pick-highlight.js');
    const pick = js.indexOf('content/float-pick.js');
    assert.ok(highlight >= 0 && pick > highlight);
  });
});
