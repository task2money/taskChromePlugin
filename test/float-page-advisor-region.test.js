'use strict';

/**
 * Alt+Shift+Z：元素点选后创新（非拖拽矩形）。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('float-page-advisor-region element pick', () => {
  it('uses click/mouseover pick, not drag rectangle overlay', () => {
    const src = fs.readFileSync(
      path.join(root, 'content/float-page-advisor-region.js'),
      'utf8',
    );
    assert.match(src, /addEventListener\('pointerdown', onRegionSelectPointerEvent/);
    assert.match(src, /addEventListener\('click', onRegionSelectPointerEvent/);
    assert.match(src, /pickGestureKind/);
    assert.match(src, /addEventListener\('mouseover', onRegionSelectMouseOver/);
    assert.match(src, /resolvePickTarget/);
    assert.match(src, /setPendingPageAdvisorElements/);
    assert.match(src, /confirmAdvisorElements/);
    assert.doesNotMatch(src, /onRegionSelectMouseDown/);
    assert.doesNotMatch(src, /pageAdvisorRegionDrag/);
    assert.doesNotMatch(
      src,
      /taskplugin-region-select-box/,
      '不得再渲染拖拽矩形框',
    );
  });

  it('closes float panel via layer single source and toggles region-selecting class', () => {
    const src = fs.readFileSync(
      path.join(root, 'content/float-page-advisor-region.js'),
      'utf8',
    );
    assert.match(src, /taskplugin-region-selecting/);
    assert.match(
      src,
      /function closeFloatPanelForRegionSelect\(\)\s*\{[\s\S]*?collapseFloatPanelDuringAdvisor\(\)/,
      '收起浮窗须委托 layer 的 collapseFloatPanelDuringAdvisor 单一实现',
    );
    assert.doesNotMatch(
      src,
      /classList\.remove\('taskplugin-open'\)/,
      '不得在 region 侧重复实现收起逻辑（会与 layer 漂移）',
    );
    assert.match(
      src,
      /stopPageAdvisorRegionSelect[\s\S]*taskplugin-region-selecting/,
    );
  });

  it('hint is non-blocking (pointer-events none) and has no full-page overlay CSS', () => {
    const css = fs.readFileSync(
      path.join(root, 'content/content-region.css'),
      'utf8',
    );
    assert.match(css, /\.taskplugin-region-select-hint/);
    assert.match(css, /pointer-events:\s*none/);
    assert.doesNotMatch(
      css,
      /#taskplugin-region-select-overlay/,
      '不得再使用全屏挡鼠标 overlay',
    );
  });

  it('remembers selected roots for retry until layer close', () => {
    const region = fs.readFileSync(
      path.join(root, 'content/float-page-advisor-region.js'),
      'utf8',
    );
    const layer = fs.readFileSync(
      path.join(root, 'content/float-page-advisor-layer.js'),
      'utf8',
    );
    const advisor = fs.readFileSync(
      path.join(root, 'content/float-page-advisor.js'),
      'utf8',
    );
    assert.match(region, /rememberPageAdvisorScopeRoots/);
    assert.match(region, /restorePageAdvisorLastCaptureForRetry/);
    assert.match(layer, /rememberPageAdvisorScopeRoots\(pendingEls\)/);
    assert.match(layer, /retryPageAdvisorSuggestFromToolbar[\s\S]*restorePageAdvisorLastCaptureForRetry/);
    assert.match(advisor, /clearPageAdvisorScopeRoots/);
    assert.doesNotMatch(region, /rememberPageAdvisorLastRegion/);
  });

  it('restorePageAdvisorLastCaptureForRetry restores the selected elements', () => {
    const vm = require('node:vm');
    const src = fs.readFileSync(
      path.join(root, 'content/float-page-advisor-region.js'),
      'utf8',
    );
    const sandbox = {
      globalThis: {},
      picked: [{ nodeType: 1, isConnected: true }],
      PageAdvisorRegion: {
        isValidRegion: (r) => r && r.width >= 20 && r.height >= 20,
      },
      console,
    };
    vm.runInNewContext(
      `${src}\n`
      + 'rememberPageAdvisorScopeRoots(picked);\n'
      + 'this.restorePageAdvisorLastCaptureForRetry = restorePageAdvisorLastCaptureForRetry;\n'
      + 'this.getPendingPageAdvisorElements = getPendingPageAdvisorElements;\n'
      + 'this.getPendingPageAdvisorRegion = getPendingPageAdvisorRegion;\n',
      sandbox,
    );
    assert.equal(sandbox.restorePageAdvisorLastCaptureForRetry(), true);
    assert.equal(sandbox.getPendingPageAdvisorElements()[0], sandbox.picked[0]);
    assert.equal(sandbox.getPendingPageAdvisorRegion(), null);
  });

  it('layer prefers capturePageContextForElements over rect', () => {
    const layer = fs.readFileSync(
      path.join(root, 'content/float-page-advisor-layer.js'),
      'utf8',
    );
    assert.match(layer, /capturePageContextForElements/);
    assert.match(layer, /getPendingPageAdvisorElements/);
  });
});
