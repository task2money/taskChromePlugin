'use strict';

/**
 * 侧栏视觉：白色统一底色 + 无描边卡片。
 * 回归点是「每块一条灰线框」——设置分区不得再写 border: 1px，
 * 页签选中态用 Professional 暗金，而不是 Catppuccin 底边。
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

  it('设置画布与分区都是白色，且无灰线框', () => {
    assert.match(settingsCss, /background-color:\s*var\(--taskplugin-background\)\s*!important/);
    assert.match(settingsCss, /background-image:\s*none\s*!important/);
    const section = ruleBodies(settingsCss, 'html[data-taskplugin-host="sidepanel"] .section');
    assert.match(section, /background:\s*var\(--taskplugin-background\)\s*!important/);
    assert.match(section, /border:\s*0/);
    assert.doesNotMatch(section, /border:\s*1px/);
    assert.match(section, /rgba\(184,\s*134,\s*11/);
    assert.match(section, /border-radius:\s*16px/);
  });

  it('通配浅色层不再给每个元素铺灰边', () => {
    const blanket = /body \*:not\(:where\(([\s\S]*?)\)\)[\s\S]*?\{([\s\S]*?)\}/.exec(settingsCss);
    assert.ok(blanket, '浅色通配层仍在');
    assert.match(blanket[2], /background:\s*var\(--taskplugin-background\)\s*!important/);
    assert.doesNotMatch(blanket[2], /border-color/);
  });

  it('次按钮文字下不另铺底色，选中单选仍用浅金底', () => {
    const btn = ruleBodies(
      settingsCss,
      'html[data-taskplugin-host="sidepanel"] .btn:not(:where(.btn-primary, .btn-danger, .btn-link))',
    );
    assert.match(btn, /border-color:\s*transparent\s*!important/);
    assert.match(btn, /background:\s*transparent\s*!important/);
    assert.match(settingsCss, /:has\(input:checked\)[\s\S]*background:\s*var\(--taskplugin-accent-muted\)\s*!important/);
  });

  it('主背景是白色，按钮内文字不另铺底色', () => {
    const tokens = read('lib/design-tokens.css');
    assert.match(tokens, /--taskplugin-background:\s*#FFFFFF\b/);
    assert.match(
      settingsCss,
      /button \*[\s\S]*?\{[^}]*background:\s*transparent\s*!important/,
    );
    const popupCss = read('popup/popup.css');
    const panelCss = read('panel/panel.css');
    const formCss = read('content/content-form.css');
    for (const css of [popupCss, panelCss]) {
      assert.match(css, /\.btn \{[^}]*background:\s*transparent/);
      assert.match(css, /button \*:not\(kbd\)[\s\S]*?background:\s*transparent\s*!important/);
    }
    assert.match(formCss, /\.taskplugin-btn \{[^}]*background:\s*transparent\s*!important/);
    assert.match(formCss, /\.taskplugin-btn \*:not\(kbd\)[\s\S]*?background:\s*transparent\s*!important/);
    assert.match(panelCss, /\.type-chip \{[^}]*background:\s*transparent/);
    assert.match(panelCss, /\.btn-danger \{[^}]*background:\s*transparent/);
  });

  it('页签选中态与壳层都是白底，字色是暗金', () => {
    const tab = ruleBodies(shellCss, '.sp-tab[aria-selected="true"]');
    assert.match(tab, /color:\s*var\(--taskplugin-accent-ink\)/);
    assert.match(tab, /background:\s*var\(--taskplugin-background\)/);
    assert.doesNotMatch(tab, /inset/);
    assert.doesNotMatch(shellCss, /inset\s+0\s+-2px\s+0\s+#89b4fa/);
    assert.match(shellCss, /background-color:\s*var\(--taskplugin-background\)/);
    assert.match(shellCss, /background-image:\s*none/);
    const tabs = ruleBodies(shellCss, '.sp-tabs');
    assert.match(tabs, /border-bottom:\s*0/);
  });
});
