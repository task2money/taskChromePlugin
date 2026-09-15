'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('float-snapshot 保留 ownerId', () => {
  it('captureOpenSnapshot 写入 ownerId', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'content', 'float-snapshot.js'),
      'utf8',
    );
    assert.match(src, /ownerId:\s*ownerSelect/);
    assert.match(src, /normalized\.ownerId/);
  });
});
