'use strict';

/**
 * Popup 插件版本号：从 chrome.runtime.getManifest() 读取，格式化为 v{version}。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { readPopupBundle } = require('./helpers/popupBundle.js');

const {
  readExtensionVersion,
  formatExtensionVersionText,
  applyExtensionVersionToElement,
} = require('../lib/plugin-version.js');

describe('readExtensionVersion', () => {
  it('从 getManifest().version 读取', () => {
    const chromeApi = { runtime: { getManifest: () => ({ version: '1.8.54' }) } };
    assert.equal(readExtensionVersion(chromeApi), '1.8.54');
  });

  it('getManifest 缺失或抛错时返回空串', () => {
    assert.equal(readExtensionVersion({}), '');
    assert.equal(readExtensionVersion({ runtime: { getManifest: () => { throw new Error('no'); } } }), '');
  });
});

describe('formatExtensionVersionText', () => {
  it('用 i18n 模板输出 v{version}', () => {
    const t = (key, params) => (key === 'popupVersionLabel' ? `v${params.version}` : key);
    assert.equal(formatExtensionVersionText('1.8.54', t), 'v1.8.54');
  });

  it('空版本返回空串', () => {
    assert.equal(formatExtensionVersionText('', () => 'v{version}'), '');
  });
});

describe('applyExtensionVersionToElement', () => {
  it('写入可见文案；无版本则 hidden', () => {
    const el = { hidden: false, textContent: '' };
    const t = (key, params) => `v${params.version}`;
    assert.equal(
      applyExtensionVersionToElement(el, { runtime: { getManifest: () => ({ version: '1.8.54' }) } }, t),
      true,
    );
    assert.equal(el.hidden, false);
    assert.equal(el.textContent, 'v1.8.54');

    const empty = { hidden: false, textContent: 'x' };
    assert.equal(applyExtensionVersionToElement(empty, {}, t), false);
    assert.equal(empty.hidden, true);
    assert.equal(empty.textContent, '');
  });
});

describe('Popup 源码契约', () => {
  it('popup.html 有 #popupVersion，并加载 plugin-version.js', () => {
    const html = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
    assert.match(html, /id="popupVersion"/);
    assert.match(html, /src="\.\.\/lib\/plugin-version\.js"/);
  });

  it('init 调用 renderPopupVersion；bundle 使用 PluginVersion', () => {
    const js = readPopupBundle();
    assert.match(js, /function renderPopupVersion/);
    assert.match(js, /renderPopupVersion\(\)/);
    assert.match(js, /globalThis\.PluginVersion/);
    assert.match(js, /applyExtensionVersionToElement/);
  });

  it('中英 i18n 含 popupVersionLabel / popupVersionAria', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'i18n-messages.js'), 'utf8');
    assert.match(src, /popupVersionLabel:\s*'v\{version\}'/);
    assert.match(src, /popupVersionAria:\s*'插件版本 \{version\}'/);
    assert.match(src, /popupVersionAria:\s*'Extension version \{version\}'/);
  });
});
