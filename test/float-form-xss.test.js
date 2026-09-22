'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('float-form XSS escape', () => {
  it('escapes load-failure copy before innerHTML', () => {
    const src = fs.readFileSync(path.join(__dirname, '../content/float-form.js'), 'utf8');
    assert.match(src, /const failMsg = /);
    assert.match(src, /innerHTML = `<option value="">\$\{esc\(failMsg\)\}<\/option>`/);
    assert.doesNotMatch(src, /innerHTML = `<option value="">\$\{id\}`/);
  });
});
