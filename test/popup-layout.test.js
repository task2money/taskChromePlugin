'use strict';

/**
 * Popup 面板布局：收窄宽度 + 快捷键说明「点击后再展开」
 *
 * 覆盖（静态验证，防止后续改动破坏）：
 *  - 面板宽度收窄（340px → 300px，快捷键说明区不需要那么宽）
 *  - 快捷键说明默认收起（#shortcutsBody 初始 display:none），点击「展开」后显示
 *  - popup.js 绑定 展开/收起 切换逻辑（与请求预览区同一交互模式）
 *  - 自定义行键位锚点独立 id（改键后列表与自定义行同步刷新，无重复 id）
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const popupHtml = read('popup/popup.html');
const popupJs = read('popup/popup.js');
const popupCss = read('popup/popup.css');

describe('Popup 面板布局', () => {
  it('面板收窄：body 宽度为 300px（不需要那么宽）', () => {
    assert.match(popupCss, /width:\s*300px/, 'popup.css body 宽度应收窄为 300px');
  });

  it('快捷键说明默认收起：#shortcutsBody 初始 display:none，内容保留', () => {
    assert.ok(popupHtml.includes('id="btnToggleShortcuts"'), '缺少「展开/收起」按钮');
    const m = popupHtml.match(/<div id="shortcutsBody"[^>]*>/);
    assert.ok(m && m[0].includes('display:none'), 'shortcutsBody 初始应折叠（点击后再展开）');
    // 折叠后内容仍完整保留在文档中
    assert.ok(popupHtml.includes('切换指针选择模式'), '快捷键列表内容缺失');
    assert.ok(popupHtml.includes('id="btnPickShortcutEdit"'), '自定义按钮应保留在折叠区内');
    assert.ok(popupHtml.includes('taskplugin-shortcut-settings'), '排查链接应保留在折叠区内');
  });

  it('popup.js 绑定「点击后展开/收起」切换逻辑', () => {
    assert.ok(popupJs.includes('btnToggleShortcuts'), 'popup.js 未读取切换按钮');
    assert.ok(popupJs.includes('shortcutsBody'), 'popup.js 未切换 shortcutsBody');
    assert.match(popupJs, /body\.style\.display === 'none'/, '缺少折叠判断');
    assert.match(popupJs, /textContent = .*展开/, '按钮文案缺少「展开」态');
  });

  it('快捷键键位锚点无重复 id：列表/自定义行/hint 各自独立，改键后全部跟随刷新', () => {
    const ids = ['pickShortcutKey', 'pickShortcutCustomKey', 'pickShortcutHintKey'];
    for (const id of ids) {
      const count = popupHtml.split(`id="${id}"`).length - 1;
      assert.equal(count, 1, `id="${id}" 应唯一（当前出现 ${count} 次）`);
    }
    assert.ok(
      popupJs.includes("['pickShortcutKey', 'pickShortcutCustomKey', 'pickShortcutHintKey']"),
      'renderPickShortcutDisplay 未同步刷新自定义行键位',
    );
  });
});
