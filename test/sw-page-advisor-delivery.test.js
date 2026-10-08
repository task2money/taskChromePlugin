'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('sw-page-advisor-delivery', () => {
  it('超限先 materialize 再打开指向文件的深链，且不粘贴全文', () => {
    const sw = fs.readFileSync(
      path.join(__dirname, '../background/sw-page-advisor-delivery.js'),
      'utf8',
    );
    const fn = sw.slice(sw.indexOf('async function handleDeliverPageAdvisorToIde'));
    assert.match(fn, /materialize:\s*true/);
    assert.match(fn, /paste:\s*false/);
    assert.match(fn, /buildFileHandoffDeeplink/);
    const materializeAt = fn.indexOf('materialize: true');
    const handoffAt = fn.indexOf('buildFileHandoffDeeplink');
    assert.ok(materializeAt >= 0 && handoffAt > materializeAt);
    assert.match(sw, /page_advisor_ide_deliver/);
    assert.doesNotMatch(sw, /textChars:\s*text[^.]/);
  });
});
