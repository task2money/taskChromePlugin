'use strict';

/**
 * Popup/侧栏设置内嵌：内置模型基础管理取消下载反馈。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'popup/popup-builtin-mgmt.js'), 'utf8');

describe('popup-builtin-mgmt download UX', () => {
  it('下载失败展示 paBuiltinFailed', () => {
    assert.match(src, /paBuiltinFailed/);
  });

  it('取消无 abort 目标时回退到 paBuiltinNeedsDownload', () => {
    assert.match(src, /cancelDownload/);
    assert.match(src, /paBuiltinNeedsDownload/);
  });
});
