'use strict';

/**
 * 工具栏图标必须切换侧边栏，不能只调用 sidePanel.open。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'background', 'sw-side-panel.js'), 'utf8');

describe('sw-side-panel toolbar toggle', () => {
  it('用 setPanelBehavior 展开或收起，不再注册 action.onClicked', () => {
    assert.match(src, /setPanelBehavior\(SidePanelBridge\.toolbarActionPanelBehavior\(\)\)/);
    assert.doesNotMatch(src, /action\.onClicked/);
  });

  it('页面消息打开记下 sidePanelOpenSource，避免图标逻辑覆盖页签', () => {
    assert.match(src, /sidePanelOpenSource:\s*\{\s*kind:\s*'message'/);
    assert.match(src, /resolveSidePanelOnShow/);
  });

  it('图标打开在判定页签前不删掉页面消息来源', () => {
    const fn = src.slice(
      src.indexOf('async function applyIconOpenTab'),
      src.indexOf('function installToolbarSidePanelToggle'),
    );
    assert.match(fn, /resolveSidePanelOnShow/);
    assert.doesNotMatch(fn, /remove\('sidePanelOpenSource'\)/);
  });
});
