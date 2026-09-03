'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('账号过期探测 fetch 省略网页 Cookie', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'background', 'sw-expiry.js'), 'utf8');
  assert.match(src, /credentials:\s*['"]omit['"]/, 'checkAllAccountsForExpiry 不得带上网页 Cookie');
});
