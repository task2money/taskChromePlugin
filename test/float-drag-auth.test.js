'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('float-drag-auth 不再隐式 resolveTaskOwner', () => {
  it('已删除 resolveTaskOwner（改由浮窗负责人下拉）', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'content', 'float-drag-auth.js'),
      'utf8',
    );
    assert.doesNotMatch(src, /function resolveTaskOwner/);
    assert.doesNotMatch(src, /无法确定任务负责人/);
  });

  it('页面没有悬浮球；打开侧栏走 openSidePanelFromPage', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'content', 'float-drag-auth.js'),
      'utf8',
    );
    assert.doesNotMatch(src, /btn\.addEventListener\('click'/);
    assert.doesNotMatch(src, /function setupDrag/);
    const boot = fs.readFileSync(
      path.join(__dirname, '..', 'content', 'float-boot.js'),
      'utf8',
    );
    assert.match(boot, /function openSidePanelFromPage/);
  });

  it('收起侧栏面板时清掉结果提示', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'content', 'content.js'),
      'utf8',
    );
    assert.match(src, /function hideFloatPanel\(\)[\s\S]*clearFloatResult\(\)/);
  });

  it('未登录角标可点击，已登录不可点击', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'content', 'float-drag-auth.js'),
      'utf8',
    );
    const unsigned = src.slice(src.indexOf('if (!loggedIn)'), src.indexOf('if (expiryHint'));
    assert.match(unsigned, /setLoginBadgeClickable\(true\)/);
    assert.match(unsigned, /去登录/);
    const signed = src.slice(src.indexOf('if (expiryHint'));
    assert.match(signed, /hideLoginBadge\(\)/);
  });

  it('侧边栏没有元素选择脚本时，setupElementPicker 不抛错', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'content', 'float-drag-auth.js'),
      'utf8',
    );
    const setup = src.slice(src.indexOf('function setupElementPicker'), src.indexOf('function syncDescResetButton'));
    assert.match(setup, /typeof onShortcutKeyDown !== 'function'\) return/);
  });
});
