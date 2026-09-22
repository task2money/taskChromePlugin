'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('float-drag-auth XSS escape', () => {
  it('escapes workspace placeholder text in option innerHTML', () => {
    const src = fs.readFileSync(path.join(__dirname, '../content/float-drag-auth.js'), 'utf8');
    assert.match(src, /innerHTML = `<option value="">\$\{typeof esc === 'function' \? esc\(text\) : String\(text\)\}<\/option>`/);
  });
});
