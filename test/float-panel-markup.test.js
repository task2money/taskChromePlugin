'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('float-panel-markup 负责人字段', () => {
  it('含 taskplugin-owner 必选下拉', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'float-panel-markup.js'),
      'utf8',
    );
    assert.match(src, /id="taskplugin-owner"/);
    assert.match(src, /负责人/);
    assert.match(src, /aria-required="true"/);
  });
});
