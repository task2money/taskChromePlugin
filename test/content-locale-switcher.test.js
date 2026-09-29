'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('content locale switcher', () => {
  it('scopes applyDom to the float root and refreshes dynamic chrome', () => {
    const src = fs.readFileSync(path.join(__dirname, '../content/content.js'), 'utf8');
    const fn = src.slice(src.indexOf('function bindFloatLocaleSwitcher'));
    const body = fn.slice(0, fn.indexOf('\nfunction '));
    assert.match(body, /taskplugin-float-root/);
    assert.match(body, /syncFloatAutoRun/);
    assert.match(body, /rerenderFloatProjectsForLocale/);
  });
});
