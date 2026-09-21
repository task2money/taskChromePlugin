'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('float-panel-markup 不含使用说明', () => {
  it('浮窗模板无 taskplugin-user-guide（说明已在 Popup）', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'float-panel-markup.js'),
      'utf8',
    );
    assert.doesNotMatch(src, /taskplugin-user-guide/);
    assert.doesNotMatch(src, /UserGuide/);
  });
});

describe('float-panel-markup 负责人字段', () => {
  it('含 taskplugin-owner 必选下拉', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'float-panel-markup.js'),
      'utf8',
    );
    assert.match(src, /id="taskplugin-owner"/);
    assert.match(src, /taskplugin-owner|panelOwner/);
    assert.match(src, /aria-required="true"/);
  });
});
