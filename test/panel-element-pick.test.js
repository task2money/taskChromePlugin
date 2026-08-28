'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('DevTools panel must not expose element pick', () => {
  it('panel.html has no 指针选择 button or pick placeholder', () => {
    const html = read('panel/panel.html');
    assert.doesNotMatch(html, /id="btnPickElement"/);
    assert.doesNotMatch(html, /🖱️ 指针选择/);
    assert.doesNotMatch(html, /用指针选择页面元素/);
    const desc = html.match(/id="singleTaskDesc"[^>]*>/);
    assert.ok(desc, 'singleTaskDesc textarea missing');
    assert.doesNotMatch(desc[0], /指针选择/);
  });

  it('single-request.js does not start or receive DevTools element pick', () => {
    const js = read('panel/tabs/single-request.js');
    assert.doesNotMatch(js, /btnPickElement/);
    assert.doesNotMatch(js, /startPageElementPick/);
    assert.doesNotMatch(js, /appendElementPickBlock/);
    assert.doesNotMatch(js, /startElementPick/);
    assert.doesNotMatch(js, /elementPickResult/);
    assert.doesNotMatch(js, /source:\s*'devtools'/);
  });

  it('service worker no longer relays pick results to DevTools', () => {
    const sw = read('background/sw-messages-task.js');
    assert.doesNotMatch(sw, /elementPickResult/);
    assert.doesNotMatch(sw, /source: message\.source \|\| 'devtools'/);
  });

  it('float markup still documents pick via shortcut, not a DevTools button', () => {
    const markup = read('lib/float-panel-markup.js');
    assert.match(markup, /id="taskplugin-desc"/);
    assert.doesNotMatch(markup, /id="btnPickElement"/);
    assert.doesNotMatch(markup, /🖱️ 指针选择/);
  });
});
