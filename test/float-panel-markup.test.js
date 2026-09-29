'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

describe('float panel markup login badge', () => {
  it('快速创建任务旁是去登录按钮', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'float-panel-markup.js'), 'utf8');
    assert.match(src, /<button type="button" id="taskplugin-login-badge"/);
    assert.match(src, /floatNotLoggedIn/);
    assert.doesNotMatch(src, /<span id="taskplugin-login-badge"/);
  });
});
