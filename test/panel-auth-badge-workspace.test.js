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
const workspaceJs = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'lib', 'workspace.js'),
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

describe('OPT-20260903-013 workspace.js 加载失败统一 data-traceId', () => {
  it('定义 P.setLoadError(el, html, err) 且内部调用 setDataTraceId', () => {
    assert.match(workspaceJs, /P\.setLoadError\s*=\s*function\s*\(\s*el\s*,\s*html\s*,\s*err\s*\)/);
    const defIdx = workspaceJs.indexOf('P.setLoadError = function');
    const slice = workspaceJs.slice(defIdx, defIdx + 200);
    assert.match(slice, /setDataTraceId\s*\(\s*el\s*,\s*err\s*\)/);
  });

  it('成员/进度列/交付物/镜像/个人配置/项目列表的加载失败全部经 P.setLoadError', () => {
    // 契约：禁止出现 innerHTML 直接拼「加载失败」而未走 setLoadError 的裸赋值；
    // 且每处「加载失败」文案行本身就是 P.setLoadError 调用。
    const lines = workspaceJs.split('\n');
    const bareAssign = lines.filter((l) => l.includes('加载失败') && l.includes('innerHTML'));
    assert.deepEqual(bareAssign, [], '存在未走 P.setLoadError 的「加载失败」裸 innerHTML 赋值');
    const loadFailLines = lines
      .map((l, i) => ({ l, i }))
      .filter((x) => x.l.includes('加载失败') && !x.l.trim().startsWith('//'));
    assert.ok(loadFailLines.length >= 7, '应覆盖全部加载失败节点');
    for (const { l, i } of loadFailLines) {
      assert.ok(
        l.includes('P.setLoadError('),
        `第 ${i + 1} 行「加载失败」未走 P.setLoadError: ${l.trim()}`,
      );
    }
  });
});
