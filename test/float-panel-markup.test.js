'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('float-panel-markup 不含使用说明', () => {
  it('浮窗模板无 taskplugin-user-guide（说明已在 Popup）', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'float-panel-markup.js'),
      'utf8',
    );
    assert.doesNotMatch(src, /taskplugin-user-guide/);
    assert.doesNotMatch(src, /UserGuide/);
  });
});

describe('float-panel-markup 负责人字段', () => {
  it('含 taskplugin-owner 必选下拉', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'float-panel-markup.js'),
      'utf8',
    );
    assert.match(src, /id="taskplugin-owner"/);
    assert.match(src, /taskplugin-owner|panelOwner/);
    assert.match(src, /aria-required="true"/);
  });
});
describe('浮窗顶栏语言选择器（OPT-20260922-037）', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

  it('markup 含紧凑语言选择器，取词走共享 t()', () => {
    const src = read('lib/float-panel-markup.js');
    assert.match(src, /id="taskplugin-float-locale"/);
    assert.match(src, /class="[^"]*taskplugin-locale-select/);
    assert.match(src, /<option value="zh-CN">/);
    assert.match(src, /<option value="en">/);
    assert.match(src, /aria-label="\$\{esc\(t\('pluginLocaleLabel'\)\)\}"/);
  });

  it('content.js 复用 PluginLocaleSwitcher 绑定，且该脚本先于 content.js 注入', () => {
    const src = read('content/content.js');
    assert.match(src, /PluginLocaleSwitcher\.bind\(\{/);
    assert.match(src, /bindFloatLocaleSwitcher\(\);/);
    const manifest = JSON.parse(read('manifest.json'));
    const js = manifest.content_scripts[0].js;
    assert.ok(js.includes('lib/locale-switcher-ui.js'), 'content 组须加载共享语言切换器');
    assert.ok(
      js.indexOf('lib/locale-switcher-ui.js') < js.indexOf('content/content.js'),
      '语言切换器须先于 content.js 注入',
    );
  });

  it('使用说明写明浮窗顶栏可切换语言', () => {
    assert.match(read('lib/user-guide.js'), /浮窗顶栏语言选择器/);
  });
});
