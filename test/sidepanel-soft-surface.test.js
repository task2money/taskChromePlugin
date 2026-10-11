'use strict';

/**
 * 侧栏视觉：浅色渐变画布 + 无描边卡片。
 * 回归点是「每块一条灰线框」——设置分区不得再写 border: 1px，
 * 页签选中态用品牌紫而不是 Catppuccin 底边。
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

describe('侧栏柔和表面', () => {
  const settingsCss = read('popup/popup-sidepanel.css');
  const shellCss = read('sidepanel/sidepanel.css');

  it('设置画布是 primary-light 到 canvas 的渐变，分区无灰线框', () => {
    assert.match(
      settingsCss,
      /background-image:\s*linear-gradient\(165deg,\s*#E6E0FF 0%,\s*#F7F9FC 240px\)/,
    );
    const section = ruleBodies(settingsCss, 'html[data-taskplugin-host="sidepanel"] .section');
    assert.match(section, /border:\s*0/);
    assert.doesNotMatch(section, /border:\s*1px/);
    assert.match(section, /rgba\(114,\s*65,\s*242/);
    assert.match(section, /border-radius:\s*16px/);
  });

  it('通配浅色层不再给每个元素铺灰边', () => {
    const blanket = /body \*:not\(:where\(([\s\S]*?)\)\)[\s\S]*?\{([\s\S]*?)\}/.exec(settingsCss);
    assert.ok(blanket, '浅色通配层仍在');
    assert.match(blanket[2], /background:\s*#fff\s*!important/);
    assert.doesNotMatch(blanket[2], /border-color/);
  });

  it('次按钮与选中单选不靠描边，而靠浅紫底', () => {
    const btn = ruleBodies(
      settingsCss,
      'html[data-taskplugin-host="sidepanel"] .btn:not(:where(.btn-primary, .btn-danger, .btn-link))',
    );
    assert.match(btn, /border-color:\s*transparent\s*!important/);
    assert.match(btn, /background:\s*#F1F2F6\s*!important/);
    assert.match(settingsCss, /:has\(input:checked\)[\s\S]*background:\s*#E6E0FF\s*!important/);
  });

  it('页签选中态是白胶囊加品牌紫字，壳层同一渐变', () => {
    const tab = ruleBodies(shellCss, '.sp-tab[aria-selected="true"]');
    assert.match(tab, /color:\s*#7241F2/);
    assert.match(tab, /background:\s*#fff/);
    assert.doesNotMatch(tab, /inset/);
    assert.doesNotMatch(shellCss, /inset\s+0\s+-2px\s+0\s+#89b4fa/);
    assert.match(shellCss, /linear-gradient\(165deg,\s*#E6E0FF 0%,\s*#F7F9FC 200px\)/);
    const tabs = ruleBodies(shellCss, '.sp-tabs');
    assert.match(tabs, /border-bottom:\s*0/);
  });
});
