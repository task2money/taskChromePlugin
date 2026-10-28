'use strict';

/**
 * OPT-20260927-001：标题行按钮共用同一个 10px 字号类。
 *
 * 字号只由 .heading-sm 提供一处定义。随调用方式/提示词 Skill 区块删除，
 * 标题行只剩登录按钮；旧标题里的集市/技能设置链接已不存在。
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

  it('登录按钮带 heading-sm；已删区块的标题行链接不再出现在 popup.html', () => {
    assert.match(tagFor('btnToggleLogin'), /\bclass="[^"]*\bheading-sm\b/, '#btnToggleLogin 缺少 heading-sm 类');
    for (const id of ['btnToggleSkillSettings', 'lnkIdleMarket', 'lnkPromptMarket', 'btnToggleLlmSettings']) {
      assert.doesNotMatch(popupHtml, new RegExp(`\\bid="${id}"`), `#${id} 属已删除区块，不应再出现`);
    }
  });

  it('popup-guide.css 已挂到 popup.html，且在 popup.css 之后、浅色层之前', () => {
    const cssAt = popupHtml.indexOf('href="popup.css"');
    const guideAt = popupHtml.indexOf('href="popup-guide.css"');
    const lightAt = popupHtml.indexOf('href="popup-sidepanel.css"');
    assert.ok(cssAt >= 0, 'popup.html 缺少 popup.css');
    assert.ok(guideAt > cssAt, 'popup-guide.css 须在 popup.css 之后加载以沿用相同层叠次序');
    assert.ok(lightAt > guideAt, 'popup-sidepanel.css 须在 popup-guide.css 之后以覆盖设置 Tab 深色底');
  });
});
