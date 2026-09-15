'use strict';

/**
 * Alt+Shift+E 框选 overlay：不得挂在 #taskplugin-float-root 内，
 * 且框选时应收起浮窗，避免面板盖住宿主页导致「只能优化悬浮面板」。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('page-advisor region overlay host', () => {
  it('mounts overlay on document.body/documentElement, not float-root', () => {
    const src = fs.readFileSync(
      path.join(root, 'content/float-page-advisor-region.js'),
      'utf8',
    );
    assert.doesNotMatch(
      src,
      /host\s*=\s*\(typeof root[\s\S]*?root\s*:\s*document\.documentElement/,
      '不得再把 overlay 挂到 float-boot 的 root（#taskplugin-float-root）',
    );
    assert.match(
      src,
      /document\.body\s*\|\|\s*document\.documentElement/,
      'overlay 宿主须为 body 或 documentElement',
    );
  });

  it('closes float panel and toggles region-selecting class while box-selecting', () => {
    const src = fs.readFileSync(
      path.join(root, 'content/float-page-advisor-region.js'),
      'utf8',
    );
    assert.match(src, /taskplugin-region-selecting/);
    assert.match(src, /classList\.remove\('taskplugin-open'\)/);
    assert.match(
      src,
      /stopPageAdvisorRegionSelect[\s\S]*taskplugin-region-selecting/,
      '退出框选须清掉 region-selecting class',
    );
  });

  it('region overlay CSS sits above float panel z-index', () => {
    const css = fs.readFileSync(
      path.join(root, 'content/content-region.css'),
      'utf8',
    );
    const contentCss = fs.readFileSync(
      path.join(root, 'content/content.css'),
      'utf8',
    );
    const overlayZ = css.match(
      /#taskplugin-region-select-overlay\s*\{[^}]*z-index:\s*(\d+)/,
    );
    const panelZ = contentCss.match(
      /#taskplugin-float-panel\s*\{[^}]*z-index:\s*(\d+)/,
    );
    assert.ok(overlayZ, 'region overlay 须声明 z-index');
    assert.ok(panelZ, 'float panel 须声明 z-index');
    assert.ok(
      Number(overlayZ[1]) >= Number(panelZ[1]),
      `overlay z-index (${overlayZ[1]}) 须 ≥ float panel (${panelZ[1]})，否则面板挡住框选`,
    );
  });
});
