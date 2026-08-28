'use strict';

/**
 * 用户可见插件名 SSOT：云端Coding: 自动创新助手
 * 内部目录/日志前缀仍为 taskChromePlugin。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { PLUGIN_DISPLAY_NAME } = require('../lib/plugin-brand.js');

const ROOT = path.join(__dirname, '..');
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const { popupPageScriptsFromHtml } = require('./helpers/popupBundle.js');

const USER_FACING = [
  'manifest.json',
  'popup/popup.html',
  'panel/panel.html',
  'devtools/devtools.html',
  'devtools/devtools.js',
  'lib/user-guide.js',
  'docs/USER_GUIDE.md',
  'README.md',
  'lib/float-panel-markup.js',
  'oauth-callback.html',
  'popup/popup.js',
];

const USER_FACING_SCAN = [...new Set([...USER_FACING, ...popupPageScriptsFromHtml()])];

describe('PLUGIN_DISPLAY_NAME', () => {
  it('SSOT 为「云端Coding: 自动创新助手」', () => {
    assert.equal(PLUGIN_DISPLAY_NAME, '云端Coding: 自动创新助手');
  });

  it('manifest name / default_title 使用 SSOT', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.equal(manifest.name, PLUGIN_DISPLAY_NAME);
    assert.equal(manifest.action.default_title, PLUGIN_DISPLAY_NAME);
  });

  it('用户可见文件不再出现旧名「云端 Coding」（空格）', () => {
    for (const rel of USER_FACING_SCAN) {
      const src = read(rel);
      assert.doesNotMatch(
        src,
        /云端 Coding/,
        `${rel} 仍含旧名「云端 Coding」`,
      );
    }
  });

  it('用户可见文件均含新显示名', () => {
    const IDENTIFIER_ONLY = new Set(['content/content.js']);
    for (const rel of USER_FACING) {
      const src = read(rel);
      if (IDENTIFIER_ONLY.has(rel)) {
        assert.match(src, /PLUGIN_DISPLAY_NAME/, `${rel} 应引用 SSOT 常量`);
        continue;
      }
      assert.ok(
        src.includes(PLUGIN_DISPLAY_NAME),
        `${rel} 缺少显示名「${PLUGIN_DISPLAY_NAME}」`,
      );
    }
  });

  it('DevTools 面板 create 使用 SSOT', () => {
    assert.match(
      read('devtools/devtools.js'),
      /chrome\.devtools\.panels\.create\(\s*PLUGIN_DISPLAY_NAME/,
    );
  });

  it('content_scripts 在 content.js 之前注入 plugin-brand.js', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const js = manifest.content_scripts[0].js;
    const brand = js.indexOf('lib/plugin-brand.js');
    const content = js.indexOf('content/content.js');
    assert.ok(brand >= 0, '缺少 lib/plugin-brand.js');
    assert.ok(brand < content, 'plugin-brand.js 须在 content.js 之前');
  });
});
