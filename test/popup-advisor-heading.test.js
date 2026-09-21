'use strict';

/**
 * Popup 默认上下文标题：展示 Alt+Shift+Z，快捷键说明收进「!」。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function popupHtml() {
  return fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
}

function i18nMessages() {
  return require('../lib/i18n-messages.js');
}

describe('Popup advisor heading', () => {
  it('默认标题为 ⌨️ Alt+Shift+Z，不含 default context / 默认上下文', () => {
    const html = popupHtml();
    const section = html.match(
      /id="pageAdvisorDefaultsSection"[\s\S]*?<\/section>/,
    )[0];
    assert.match(section, /data-i18n="altZDefaults">Alt\+Shift\+Z</);
    assert.doesNotMatch(section, /default context|默认上下文/);
    const msg = i18nMessages();
    assert.equal(msg.zh.altZDefaults, 'Alt+Shift+Z');
    assert.equal(msg.en.altZDefaults, 'Alt+Shift+Z');
  });

  it('快捷键说明收在 ! 的 details/summary 内且默认不展开', () => {
    const html = popupHtml();
    const section = html.match(
      /id="pageAdvisorDefaultsSection"[\s\S]*?<\/section>/,
    )[0];
    assert.match(section, /<summary[^>]*>!<\/summary>/);
    assert.match(section, /<details[\s\S]*data-i18n="altZHint"/);
    assert.doesNotMatch(section, /<details\s[^>]*\bopen\b/);
    const hintOutside = section.replace(/<details[\s\S]*?<\/details>/, '');
    assert.doesNotMatch(hintOutside, /data-i18n="altZHint"/);
  });
});
