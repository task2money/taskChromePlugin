'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('user-guide-en-sections', () => {
  it('documents copyable traceId line for LLM / timeout errors', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../lib/user-guide-en-sections.js'),
      'utf8',
    );
    assert.match(src, /traceId:/);
    assert.match(src, /data-traceId/);
  });

  it('documents system default skill fetch and reopen-popup recovery', () => {
    const { STEPS_EN } = require('../lib/user-guide-en-sections.js');
    const blob = (STEPS_EN['page-optimization-suggest'] || []).join('\n');
    assert.match(blob, /Only the auto-innovate skill is preloaded even while signed out/);
    assert.match(blob, /Do not apply/);
  });
});
