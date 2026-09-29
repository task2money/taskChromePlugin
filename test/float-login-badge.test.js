'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('快速创建任务旁去登录', () => {
  it('标题旁是按钮，文案为去登录', () => {
    const markup = read('lib/float-panel-markup.js');
    assert.match(markup, /<button type="button" id="taskplugin-login-badge"/);
    assert.doesNotMatch(markup, /<span id="taskplugin-login-badge"/);
    const i18n = read('lib/i18n-ui-messages.js');
    assert.match(i18n, /floatNotLoggedIn: '去登录'/);
    assert.match(i18n, /floatNotLoggedIn: 'Sign in'/);
  });

  it('未登录可点并走 oauthStart，已登录不可点', () => {
    const auth = read('content/float-drag-auth.js');
    const unsigned = auth.slice(auth.indexOf('if (!loggedIn)'), auth.indexOf('if (expiryHint'));
    assert.match(unsigned, /setLoginBadgeClickable\(true\)/);
    assert.match(unsigned, /floatNotLoggedIn/);
    const signed = auth.slice(auth.indexOf("tx('floatBadgeLoggedIn')"));
    assert.match(signed, /setLoginBadgeClickable\(false\)/);
  });

  it('点击经同步门闩发起与弹窗相同的 oauthStart', () => {
    const src = read('content/float-login-badge.js');
    assert.match(src, /createClickGuard/);
    assert.match(src, /action: 'oauthStart'/);
    assert.match(src, /baseUrl/);
    assert.match(src, /aria-busy/);
    const manifest = JSON.parse(read('manifest.json'));
    const js = manifest.content_scripts[0].js;
    const drag = js.indexOf('content/float-drag-auth.js');
    const login = js.indexOf('content/float-login-badge.js');
    assert.ok(drag >= 0 && login === drag + 1);
  });
});
