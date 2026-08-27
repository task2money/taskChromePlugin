'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panelCore = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'lib', 'panel-core.js'),
  'utf8',
);
const panelHtml = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'panel.html'),
  'utf8',
);

describe('DevTools panel 角标与工作空间登录态一致', () => {
  it('panel.html 在 panel-core 之前注入 float-workspace-select.js', () => {
    const selIdx = panelHtml.indexOf('lib/float-workspace-select.js');
    const coreIdx = panelHtml.indexOf('lib/panel-core.js');
    assert.ok(selIdx >= 0, '须加载 float-workspace-select.js');
    assert.ok(coreIdx >= 0, '须加载 panel-core.js');
    assert.ok(selIdx < coreIdx, 'FloatWorkspaceSelect 须先于 panel-core 可用');
  });

  it('角标定时刷新在已登录且下拉仍是占位时补拉工作空间', () => {
    const timerIdx = panelCore.indexOf('api.startAuthBadgeTimer');
    assert.ok(timerIdx >= 0);
    const slice = panelCore.slice(timerIdx, timerIdx + 1800);
    assert.match(slice, /selectNeedsWorkspaceLoad/);
    assert.match(slice, /loadWorkspaces\('singleWorkspace'\)/);
    assert.match(slice, /loadWorkspaces\('batchWorkspace'\)/);
  });
});
