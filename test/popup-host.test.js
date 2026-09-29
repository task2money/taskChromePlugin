'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const host = require('../popup/popup-host.js');

describe('popup sidepanel host', () => {
  it('只在 host=sidepanel 时给 html 打上属性', () => {
    const attrs = {};
    const doc = { documentElement: { setAttribute(name, value) { attrs[name] = value; } } };
    assert.equal(host.applySidepanelHost('?host=sidepanel', doc), true);
    assert.equal(attrs['data-taskplugin-host'], 'sidepanel');
    assert.equal(host.applySidepanelHost('', { documentElement: doc.documentElement }), false);
    assert.equal(host.applySidepanelHost('?host=popup', doc), false);
  });

  it('设置页在样式表之前加载外部脚本，不用内联脚本', () => {
    const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup.html'), 'utf8');
    const hostAt = popupHtml.indexOf('src="popup-host.js"');
    const cssAt = popupHtml.indexOf('href="popup.css"');
    assert.ok(hostAt >= 0 && cssAt > hostAt, 'popup-host.js 须在样式表之前同步加载');
    assert.doesNotMatch(popupHtml, /<script>[^<]*data-taskplugin-host/);
  });
});
