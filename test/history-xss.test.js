'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('history tab XSS escape', () => {
  it('escapes resultId and button data-id', () => {
    const src = fs.readFileSync(path.join(__dirname, '../panel/tabs/history.js'), 'utf8');
    assert.match(src, /P\.escHtml\(item\.resultId\)/);
    assert.match(src, /data-id="\$\{P\.escHtml\(item\.id\)\}"/);
  });
});
