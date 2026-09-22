'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('popup XSS escape', () => {
  it('escapes captured request method/id in innerHTML templates', () => {
    const src = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
    assert.match(src, /escHtml\(req\.method\)/);
    assert.match(src, /escHtml\(req\.id\)/);
    assert.doesNotMatch(src, /innerHTML = tx\('popupNoMatchingRequests'\)/);
  });
});
