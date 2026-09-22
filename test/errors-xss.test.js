'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('errors tab XSS escape', () => {
  it('escapes captured method before innerHTML', () => {
    const src = fs.readFileSync(path.join(__dirname, '../panel/tabs/errors.js'), 'utf8');
    assert.match(src, /P\.escHtml\(e\.method\)/);
    assert.doesNotMatch(src, /req-method \$\{e\.method\}/);
  });
});
