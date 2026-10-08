'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('float-page-advisor-deliver', () => {
  it('把批次数交给状态文案，不再传递本机文件路径', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-deliver.js'),
      'utf8',
    );
    assert.match(src, /batchCount:\s*batchCount/);
    assert.match(src, /formatUserStatus/);
    assert.doesNotMatch(src, /promptPath/);
    assert.doesNotMatch(src, /nativeOk/);
  });
});
