'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('float-page-advisor-deliver', () => {
  it('把超限与本地文件路径交给状态文案，避免把截断深链说成已填入', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-deliver.js'),
      'utf8',
    );
    assert.match(src, /overflow:\s*overflow/);
    assert.match(src, /promptPath:\s*promptPath/);
    assert.match(src, /formatUserStatus/);
  });
});
