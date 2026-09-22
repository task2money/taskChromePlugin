'use strict';

/**
 * OPT-20260922-007：插件页内注入 UI 的滚动条应与工作台 DESIGN「Overlay scrollbars」
 * 一致（6px、半透明 thumb、悬浮才显形）。插件注入样式不继承工作台 CSS，宿主页面
 * 多数没有 overlay 规则，故 content.css 自带一份。
 * 同时守住「滚动容器不相互嵌套」——嵌套会出现双滚动条，与看板卡片的滚动语言不符。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CSS_FILES = [
  'content/content.css',
  'content/content-form.css',
  'content/content-guide.css',
  'content/content-region.css',
  'content/page-advisor.css',
];

/** 允许的页内滚动容器。新增滚动容器须显式改这里，并同步 content.css 的 overlay 选择器。 */
const SCROLL_CONTAINERS = [
  '.taskplugin-checkbox-list',
  '.taskplugin-panel-body',
  '.taskplugin-user-guide-host .tcp-guide-body',
];

/** CSS 中声明 overflow: auto|scroll 的选择器（忽略注释）。 */
function declaredScrollContainers() {
  const found = new Set();
  for (const rel of CSS_FILES) {
    for (const m of read(rel).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!/overflow(-[xy])?\s*:\s*(auto|scroll)/.test(m[2])) continue;
      found.add(m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' '));
    }
  }
  return [...found].sort();
}

function overlayBlock() {
  const at = read('content/content.css').indexOf('覆盖层细滚动条');
  assert.ok(at > 0, 'content.css 缺少「覆盖层细滚动条」段落');
  return read('content/content.css').slice(at);
}

describe('插件页内滚动条对齐工作台 overlay 风格（OPT-20260922-007）', () => {
  it('声明的滚动容器与清单一致（防无意的嵌套/新增滚动区）', () => {
    assert.deepEqual(declaredScrollContainers(), SCROLL_CONTAINERS);
  });

  it('overlay 规则覆盖每个滚动容器', () => {
    const block = overlayBlock();
    for (const sel of SCROLL_CONTAINERS) {
      assert.ok(block.includes(sel), `overlay 选择器缺少 ${sel}`);
    }
  });

  it('尺寸 6px、轨道透明、thumb 半透明且悬浮才显形', () => {
    const block = overlayBlock();
    assert.match(block, /scrollbar-width:\s*thin/);
    assert.match(block, /::-webkit-scrollbar\s*\{[^}]*width:\s*6px/);
    assert.match(block, /::-webkit-scrollbar\s*\{[^}]*height:\s*6px/);
    assert.match(block, /::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent/);
    assert.match(block, /::-webkit-scrollbar-thumb\s*\{[^}]*rgba\(108,\s*112,\s*134/);
    assert.match(block, /border-radius:\s*999px/);
    assert.match(block, /@media\s*\(hover:\s*hover\)/);
  });

  it('未使用 color-mix（扩展未声明 minimum_chrome_version）', () => {
    assert.doesNotMatch(overlayBlock(), /color-mix\(/);
  });
});
