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
    assert.match(src, /Filling the task description switches to Create task/);
    assert.match(src, /highlight box/);
  });

  it('未登录时标题旁 Sign in 点击后走 OAuth', () => {
    assert.match(src, /shows Sign in beside the title/);
    assert.match(src, /same OAuth sign-in as the popup/);
    assert.match(src, /After sign-in the button hides and the workspace list loads/);
  });

  it('直连 Key 标明不上传，换浏览器需要重新设置', () => {
    assert.match(src, /not uploaded; set it again after switching browsers/);
    assert.doesNotMatch(src, /stored in this browser LocalStorage/);
    assert.doesNotMatch(src, /\(free;/);
  });
});
