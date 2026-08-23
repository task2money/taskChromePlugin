'use strict';

/**
 * DevTools 在 HAR 无 postData 时向 SW lookupRequestBody 补请求体
 */

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const SRC = path.join(__dirname, '../devtools/devtools.js');

describe('devtools request body lookup', () => {
  const src = fs.readFileSync(SRC, 'utf8');

  it('queries SW lookupRequestBody when HAR requestBody is empty', () => {
    assert.match(src, /action:\s*'lookupRequestBody'/);
    assert.match(src, /function fillRequestBodyFromSw/);
    assert.match(src, /await fillRequestBodyFromSw\(req\)/);
  });

  it('does not log the captured request body', () => {
    assert.doesNotMatch(src, /console\.(log|debug|info)\([^)]*requestBody/);
    assert.doesNotMatch(src, /console\.(log|debug|info)\([^)]*res\.body/);
  });
});
