'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('float-boot locale hydrate', () => {
  it('reapplies float copy after storage locale is known', () => {
    const boot = fs.readFileSync(path.join(__dirname, '../content/float-boot.js'), 'utf8');
    const hydrate = boot.slice(boot.indexOf('function hydrateFloatI18n'));
    const body = hydrate.slice(0, hydrate.indexOf('})();') + 4);
    assert.match(body, /hydrateFromStorage/);
    assert.match(body, /applyDom\s*\(\s*root\s*\)/);
  });
});
