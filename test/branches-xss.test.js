'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('branches XSS escape', () => {
  it('escapes builtin branch names in datalist innerHTML', () => {
    const src = fs.readFileSync(path.join(__dirname, '../panel/lib/branches.js'), 'utf8');
    assert.match(src, /P\.escHtml\(b\)/);
    assert.doesNotMatch(src, /option value="\$\{b\}"/);
  });
});
