'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('sw-page-advisor-delivery', () => {
  it('超限按 buildIdeDeeplinkBatches 逐批 tabs.create，不调用本机桥', () => {
    const sw = fs.readFileSync(
      path.join(__dirname, '../background/sw-page-advisor-delivery.js'),
      'utf8',
    );
    const fn = sw.slice(sw.indexOf('async function handleDeliverPageAdvisorToIde'));
    assert.match(fn, /buildIdeDeeplinkBatches/);
    assert.match(fn, /contentPrefix/);
    assert.match(fn, /prefixChars/);
    assert.doesNotMatch(fn, /prefix:\s*contentPrefix/);
    assert.match(fn, /openPageAdvisorIdeDeeplink/);
    assert.match(fn, /waitPageAdvisorBatchGap/);
    assert.match(sw, /page_advisor_ide_deliver/);
    assert.doesNotMatch(sw, /sendNativeMessage/);
    assert.doesNotMatch(sw, /materialize/);
    assert.doesNotMatch(sw, /buildFileHandoffDeeplink/);
    assert.doesNotMatch(sw, /slice\(0,\s*next\)/);
  });
});
