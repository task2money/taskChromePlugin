'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('user-guide-en-sections', () => {
  it('英文使用说明写明超长深链不截断', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../lib/user-guide-en-sections.js'),
      'utf8',
    );
    assert.match(src, /Text over the deeplink URL limit is not truncated; suggestions are forwarded in batches/);
    assert.equal(src.includes('native bridge'), false);
  });
});
