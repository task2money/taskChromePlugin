'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('float-form locale', () => {
  it('keeps placeholder options and auto-run hints translatable after render', () => {
    const src = fs.readFileSync(path.join(__dirname, '../content/float-form.js'), 'utf8');
    assert.match(src, /data-i18n="commonSelectWsOption"/);
    assert.match(src, /data-i18n="floatPleaseLoginFirst"/);
    assert.match(src, /applyAutoRunControlToElements\(autoRunInput, autoRunHint, st, \{ t: \(key\) => \(typeof tx === 'function' \? tx\(key\) : key\) \}\)/);
  });
});
