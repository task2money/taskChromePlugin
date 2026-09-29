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
    assert.match(bridge.sidePanelOpenHint('zh-CN'), /侧边栏/);
    assert.match(bridge.sidePanelOpenHint('en'), /side panel/);
    assert.doesNotMatch(bridge.sidePanelOpenHint('en'), /侧边栏/);
  });
});

describe('side panel manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

  it('去掉工具栏 popup，改为侧边栏', () => {
    assert.equal(manifest.action.default_popup, undefined);
    assert.ok(manifest.permissions.includes('sidePanel'));
    assert.equal(manifest.side_panel.default_path, 'sidepanel/sidepanel.html');
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
