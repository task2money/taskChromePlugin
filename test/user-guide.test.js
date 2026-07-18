'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const UserGuide = require('../lib/user-guide.js');

const REQUIRED_IDS = [
  'overview',
  'login',
  'float-create',
  'element-pick',
  'devtools-single',
  'devtools-batch',
  'popup-extras',
];

describe('UserGuide sections', () => {
  it('exposes required section ids', () => {
    const ids = UserGuide.listSectionIds();
    for (const id of REQUIRED_IDS) {
      assert.ok(ids.includes(id), `missing section id: ${id}`);
    }
  });

  it('filters sections by surface', () => {
    const floatIds = UserGuide.getSectionsForSurface('float').map((s) => s.id);
    assert.ok(floatIds.includes('element-pick'));
    assert.ok(floatIds.includes('float-create'));
    assert.ok(!floatIds.includes('popup-extras'));

    const popupIds = UserGuide.getSectionsForSurface('popup').map((s) => s.id);
    assert.ok(popupIds.includes('popup-extras'));
    assert.ok(popupIds.includes('login'));
  });

  it('renderCollapsibleHtml includes surface and section markers', () => {
    const html = UserGuide.renderCollapsibleHtml({ surface: 'float', open: false });
    assert.match(html, /data-guide-surface="float"/);
    assert.match(html, /data-guide-id="element-pick"/);
    assert.match(html, /使用说明/);
    assert.match(html, /Shift/);
  });

  it('renderFullGuideHtml for panel includes batch section', () => {
    const html = UserGuide.renderFullGuideHtml({ surface: 'panel' });
    assert.match(html, /data-guide-id="devtools-batch"/);
    assert.match(html, /5xx/);
  });

  it('escapeHtml escapes angle brackets', () => {
    assert.equal(UserGuide.escapeHtml('<script>'), '&lt;script&gt;');
  });
});

describe('USER_GUIDE.md sync', () => {
  it('documents every section id from user-guide.js', () => {
    const mdPath = path.join(__dirname, '../docs/USER_GUIDE.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    for (const id of UserGuide.listSectionIds()) {
      assert.ok(md.includes(`\`${id}\``) || md.includes(id), `USER_GUIDE.md missing id ${id}`);
    }
  });
});
