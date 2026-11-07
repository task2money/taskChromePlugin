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
    assert.match(src, /resolveSidePanelIntent/);
  });

  it('悬浮球打开先调用 sidePanel.open，再写 storage', () => {
    const begin = src.slice(
      src.indexOf('function beginSidePanelOpenFromGesture'),
      src.indexOf('async function finishSidePanelOpenFromGesture'),
    );
    const finish = src.slice(
      src.indexOf('async function finishSidePanelOpenFromGesture'),
      src.indexOf('async function openSidePanelOnTab'),
    );
    assert.match(begin, /chrome\.sidePanel\.open\(\{\s*tabId\s*\}\)/);
    assert.doesNotMatch(begin, /await /);
    assert.match(finish, /chrome\.storage\.session\.set/);
    const openAt = begin.indexOf('chrome.sidePanel.open');
    assert.ok(openAt > begin.indexOf('pendingSidePanelMessage'));
  });

  it('工具栏图标打开落在默认页签（网页优化），不再写死设置', () => {
    const fn = src.slice(
      src.indexOf('async function applyIconOpenTab'),
      src.indexOf('function sidePanelIntentWhich'),
    );
    assert.match(fn, /let which = SidePanelBridge\.DEFAULT_SIDE_PANEL_TAB/);
    assert.doesNotMatch(fn, /which = 'settings'/);
  });

  it('图标打开在判定页签前不删掉页面消息来源', () => {
    const fn = src.slice(
      src.indexOf('async function applyIconOpenTab'),
      src.indexOf('function sidePanelIntentWhich'),
    );
    assert.match(fn, /sidePanelIntentWhich/);
    assert.doesNotMatch(fn, /remove\('sidePanelOpenSource'\)/);
  });
});
