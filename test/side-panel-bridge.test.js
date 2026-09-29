'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const bridge = require('../lib/side-panel-bridge.js');

describe('side panel tab', () => {
  it('未知值落到创建任务页签', () => {
    assert.equal(bridge.normalizeSidePanelTab('settings'), 'settings');
    assert.equal(bridge.normalizeSidePanelTab('create'), 'create');
    assert.equal(bridge.normalizeSidePanelTab(''), 'create');
    assert.equal(bridge.normalizeSidePanelTab(undefined), 'create');
  });

  it('任务描述草稿使用固定 session 键', () => {
    assert.equal(bridge.createDescStorageKey(), 'sidePanelCreateDesc');
  });

  it('打不开侧边栏时的提示按语言区分', () => {
    assert.match(bridge.sidePanelOpenHint('zh-CN'), /展开或收起侧边栏/);
    assert.match(bridge.sidePanelOpenHint('en'), /open or close the side panel/);
    assert.doesNotMatch(bridge.sidePanelOpenHint('en'), /侧边栏/);
  });

  it('工具栏图标交给浏览器展开或收起侧边栏', () => {
    assert.deepEqual(bridge.toolbarActionPanelBehavior(), { openPanelOnActionClick: true });
  });

  it('图标打开切到设置，页面消息刚打开时不覆盖页签', () => {
    const now = 10000;
    assert.equal(bridge.iconOpenShouldSelectSettings(null, now), true);
    assert.equal(bridge.iconOpenShouldSelectSettings({ kind: 'message', at: now - 100 }, now), false);
    assert.equal(bridge.iconOpenShouldSelectSettings({ kind: 'message', at: now - 2000 }, now), true);
  });

  it('图标打开固定设置；填入或悬浮球消息在 2 秒内保留创建页', () => {
    const now = 10000;
    const fresh = { kind: 'message', at: now - 100 };
    assert.equal(bridge.resolveSidePanelOnShow(null, 'create', now), 'settings');
    assert.equal(bridge.resolveSidePanelOnShow(fresh, 'create', now), 'create');
    assert.equal(bridge.resolveSidePanelOnShow({ kind: 'message', at: now - 2000 }, 'create', now), 'settings');
  });
});

describe('side panel manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

  it('去掉工具栏 popup，改为侧边栏', () => {
    assert.equal(manifest.action.default_popup, undefined);
    assert.ok(manifest.permissions.includes('sidePanel'));
    assert.equal(manifest.side_panel.default_path, 'sidepanel/sidepanel.html');
  });

  it('工具栏点击用 setPanelBehavior 切换，不再用 onClicked 只打开', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'background', 'sw-side-panel.js'), 'utf8');
    assert.match(src, /setPanelBehavior\(SidePanelBridge\.toolbarActionPanelBehavior\(\)\)/);
    assert.doesNotMatch(src, /action\.onClicked/);
  });

  it('创建任务与设置页签背景为白色，设置 iframe 铺满宽度', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.css'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.html'), 'utf8');
    const settingsCss = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup-sidepanel.css'), 'utf8');
    assert.match(css, /\.sp-tab[\s\S]*background:\s*#fff/);
    assert.match(css, /\.sp-pane[\s\S]*background:\s*#fff/);
    assert.match(css, /#taskplugin-float-panel[\s\S]*background:\s*#fff/);
    assert.match(html, /popup\.html\?host=sidepanel/);
    assert.match(settingsCss, /width:\s*100%/);
    assert.match(settingsCss, /background:\s*#fff/);
  });
});

describe('float markup host split', () => {
  const markup = require('../lib/float-panel-markup.js');

  it('页面只留悬浮球和元素调整框', () => {
    const html = markup.html('page');
    assert.match(html, /id="taskplugin-float-btn"/);
    assert.match(html, /id="taskplugin-adjust-modal"/);
    assert.doesNotMatch(html, /id="taskplugin-float-panel"/);
    assert.doesNotMatch(html, /id="taskplugin-desc"/);
  });

  it('侧边栏创建页签只有表单', () => {
    const html = markup.html('form');
    assert.match(html, /id="taskplugin-float-panel"/);
    assert.match(html, /id="taskplugin-desc"/);
    assert.match(html, /id="taskplugin-submit"/);
    assert.doesNotMatch(html, /id="taskplugin-float-btn"/);
  });
});
