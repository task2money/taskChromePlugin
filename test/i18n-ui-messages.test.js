'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

describe('i18n ui login badge copy', () => {
  it('未登录角标文案是去登录', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'i18n-ui-messages.js'), 'utf8');
    assert.match(src, /floatNotLoggedIn: '去登录'/);
    assert.match(src, /floatNotLoggedIn: 'Sign in'/);
    assert.match(src, /floatOauthOpened: '已打开授权页，请在新标签页完成登录'/);
  });
});
