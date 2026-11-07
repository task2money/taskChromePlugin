'use strict';

/**
 * 侧栏页签「网页优化」标题居中。
 *
 * 回归点（用户反馈：网页优化应该居中）：
 * 1. 未读数徽标曾作为 flex 行内元素占 20px + 6px gap，把标题挤左 13px；
 * 2. popup-sidepanel.css 的通配白底 / 透明层把徽标的强调色底抹成透明，
 *    白字落在白底页签上等于看不见，只剩「标题莫名左偏」。
 *
 * 约束：徽标必须绝对定位、落在文字行上方（窄侧栏也不压字），且保留自己的底色。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function ruleBodies(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const bodies = [...css.matchAll(re)].map((match) => match[1]);
  assert.ok(bodies.length > 0, `缺少规则 ${selector}`);
  return bodies.join('\n');
}

describe('侧栏「网页优化」页签标题居中', () => {
  const shellCss = read('sidepanel/sidepanel.css');
  const settingsCss = read('popup/popup-sidepanel.css');

  it('页签保持 flex 居中，徽标改为绝对定位不再挤占标题空间', () => {
    const tab = ruleBodies(shellCss, '.sp-tab');
    assert.match(tab, /display:\s*inline-flex/);
    assert.match(tab, /justify-content:\s*center/);
    assert.match(tab, /position:\s*relative/, '页签要成为徽标的定位容器');

    const badge = ruleBodies(shellCss, '.sp-agent-count');
    assert.match(badge, /position:\s*absolute/, '徽标不能留在 flex 行内挤偏标题');
    assert.match(badge, /top:\s*-?\d/, '徽标要贴页签右上角');
    assert.match(badge, /right:\s*\d/, '徽标要贴页签右上角');
  });

  it('徽标落在文字行上方，避免窄侧栏压住标题', () => {
    const badge = ruleBodies(shellCss, '.sp-agent-count');
    const top = Number((/top:\s*(-?\d+(?:\.\d+)?)/.exec(badge) || [])[1]);
    const lineHeight = Number((/line-height:\s*(\d+(?:\.\d+)?)(rem|px)/.exec(badge) || [])[1]);
    const unit = (/line-height:\s*\d+(?:\.\d+)?(rem|px)/.exec(badge) || [])[1];
    assert.ok(Number.isFinite(top) && top < 0, '徽标要向上越出文字行的垂直带');
    const badgeHeight = unit === 'rem' ? lineHeight * 16 : lineHeight;
    // 页签 44px、标题 12px/约 14.4px 行高 → 文字行从约 14.8px 开始。
    assert.ok(top + badgeHeight <= 14.8, `徽标底边 ${top + badgeHeight}px 不得压到文字行`);
  });

  it('徽标保留强调色底与反色文字，不被通配层抹掉', () => {
    const badge = ruleBodies(shellCss, '.sp-agent-count');
    assert.match(badge, /background:\s*var\(--taskplugin-accent-ink\)/);
    assert.match(badge, /color:\s*var\(--taskplugin-background\)/);

    // 通配白底（body *）的 :where() 排除清单里必须有徽标。
    const blanket = /body \*:not\(:where\(([\s\S]*?)\)\)/.exec(settingsCss);
    assert.ok(blanket, '缺少通配白底规则');
    assert.match(blanket[1], /\.sp-agent-count/, '通配白底会把徽标涂成白底');

    // 两条「按钮内文字层透明」规则都要放过徽标，否则金色底被强制透明。
    assert.match(
      settingsCss,
      /\.sp-tab \*:not\(kbd\):not\(\.tcp-guide-kbd\):not\(\.sp-agent-count\)/,
      '页签透明层要排除未读数徽标',
    );
    assert.match(
      settingsCss,
      /\) \*:not\(kbd\):not\(\.tcp-guide-kbd\):not\(\.sp-agent-count\)\s*\{/,
      ':is(...) 透明层要排除未读数徽标',
    );
    // sidepanel.html 也加载 popup.css，其中 button * 的透明层同样要放过徽标。
    const popupCss = read('popup/popup.css');
    assert.match(
      popupCss,
      /button \*:not\(kbd\):not\(\.tcp-guide-kbd\):not\(\.sp-agent-count\)/,
      'popup.css 的 button * 透明层要排除未读数徽标',
    );
    // 侧栏壳层自己的 :is(.taskplugin-btn, .sp-tab, button) * 透明层同样要排除徽标。
    assert.match(
      shellCss,
      /:is\(\.taskplugin-btn, \.sp-tab, button\) \*:not\(kbd\):not\(\.tcp-guide-kbd\):not\(\.sp-agent-count\)/,
      'sidepanel.css 的按钮透明层要排除未读数徽标',
    );
  });
});
