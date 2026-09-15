'use strict';

/**
 * Alt+Shift+E：元素点选后创新（非拖拽矩形）。
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
    assert.match(src, /addEventListener\('click', onRegionSelectClick/);
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

  it('closes float panel and toggles region-selecting class', () => {
    const src = fs.readFileSync(
      path.join(root, 'content/float-page-advisor-region.js'),
      'utf8',
    );
    assert.match(src, /taskplugin-region-selecting/);
    assert.match(src, /classList\.remove\('taskplugin-open'\)/);
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

  it('remembers lastRegion for retry until layer close', () => {
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
    assert.match(region, /rememberPageAdvisorLastRegion/);
    assert.match(region, /restorePageAdvisorLastCaptureForRetry/);
    assert.match(layer, /rememberPageAdvisorLastRegion\(pendingRegion\)/);
    assert.match(layer, /retryPageAdvisorSuggestFromToolbar[\s\S]*restorePageAdvisorLastCaptureForRetry/);
    assert.match(advisor, /clearPageAdvisorLastRegion/);
  });

  it('restorePageAdvisorLastCaptureForRetry sets pending region', () => {
    const vm = require('node:vm');
    const src = fs.readFileSync(
      path.join(root, 'content/float-page-advisor-region.js'),
      'utf8',
    );
    const sandbox = {
      globalThis: {},
      PageAdvisorRegion: {
        isValidRegion: (r) => r && r.width >= 20 && r.height >= 20,
      },
      console,
    };
    vm.runInNewContext(
      `${src}\n`
      + 'rememberPageAdvisorLastRegion({ left: 1, top: 2, width: 100, height: 80 });\n'
      + 'this.restorePageAdvisorLastCaptureForRetry = restorePageAdvisorLastCaptureForRetry;\n'
      + 'this.getPendingPageAdvisorRegion = getPendingPageAdvisorRegion;\n',
      sandbox,
    );
    assert.equal(sandbox.restorePageAdvisorLastCaptureForRetry(), true);
    const pending = sandbox.getPendingPageAdvisorRegion();
    assert.equal(pending.width, 100);
    assert.equal(pending.height, 80);
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
