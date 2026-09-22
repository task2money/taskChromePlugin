'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('i18n catalog HTML sink', () => {
  it('marks data-i18n-html as first-party XSS-OK', () => {
    const src = fs.readFileSync(path.join(__dirname, '../lib/i18n.js'), 'utf8');
    assert.match(src, /data-i18n-html[\s\S]{0,200}XSS-OK:/);
  });
});
