'use strict';

/**
 * OPT-20260927-001：标题行「设置」按钮与「闲置集市」链接共用同一个 10px 字号类。
 *
 * 此前链接用小行内 `font-size:10px` 对齐按钮，行内值与样式表各改各的，
 * 标题行字号会漂移。现在字号只由 .heading-sm 提供一处定义，两组元素共用。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const popupHtml = read('popup/popup.html');
const popupCss = read('popup/popup.css');

/** 取 popup.html 中某个 id 元素的起始标签 */
function tagFor(id) {
  const m = popupHtml.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(m, `popup.html 缺少 #${id}`);
  return m[0];
}

describe('Popup 标题行字号由 .heading-sm 单点提供', () => {
  it('.heading-sm 在 popup.css 中只有一处 font-size 定义', () => {
    const decls = popupCss.match(/\.heading-sm\s*\{[^}]*\}/g) || [];
    assert.equal(decls.length, 1, '.heading-sm 应只有一条规则');
    assert.match(decls[0], /font-size:\s*10px\s*;/, '.heading-sm 须定义 font-size: 10px');
  });

  it('.heading-sm 排在 .btn-sm 之后，才能覆盖按钮默认字号', () => {
    const headingAt = popupCss.indexOf('.heading-sm {');
    const btnSmAt = popupCss.indexOf('.btn-sm {');
    assert.ok(btnSmAt >= 0, 'popup.css 缺少 .btn-sm');
    assert.ok(headingAt > btnSmAt, '.heading-sm 必须在 .btn-sm 之后，否则被其 11px 覆盖');
  });

  it('设置/登录/技能按钮与闲置集市链接都带 heading-sm', () => {
    for (const id of ['btnToggleLogin', 'btnToggleLlmSettings', 'btnToggleSkillSettings', 'lnkIdleMarket']) {
      assert.match(tagFor(id), /\bclass="[^"]*\bheading-sm\b/, `#${id} 缺少 heading-sm 类`);
    }
  });

  it('闲置集市链接不再用行内字号，按钮规则也不再自带 font-size', () => {
    assert.doesNotMatch(tagFor('lnkIdleMarket'), /style=/, '#lnkIdleMarket 不得再有行内 style');
    assert.doesNotMatch(popupCss, /#btnToggleLlmSettings[^{]*\{[^}]*font-size/,
      '按钮规则里的 font-size 应只由 .heading-sm 提供');
  });

  it('链接的不换行与不收缩改由 popup.css 规则承担', () => {
    assert.match(popupCss, /#lnkIdleMarket\s*\{[^}]*white-space:\s*nowrap/);
    assert.match(popupCss, /#lnkIdleMarket\s*\{[^}]*flex-shrink:\s*0/);
  });

  it('popup-guide.css 已挂到 popup.html，且在 popup.css 之后', () => {
    const cssAt = popupHtml.indexOf('href="popup.css"');
    const guideAt = popupHtml.indexOf('href="popup-guide.css"');
    assert.ok(cssAt >= 0, 'popup.html 缺少 popup.css');
    assert.ok(guideAt > cssAt, 'popup-guide.css 须在 popup.css 之后加载以沿用相同层叠次序');
  });
});
