'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const bridge = require('../lib/side-panel-bridge.js');

describe('side panel tab', () => {
  it('未知值落到创建任务页签', () => {
    assert.equal(bridge.normalizeSidePanelTab('settings'), 'settings');
    assert.equal(bridge.normalizeSidePanelTab('create'), 'create');
    assert.equal(bridge.normalizeSidePanelTab('builtin'), 'builtin');
    assert.equal(bridge.normalizeSidePanelTab(''), 'create');
    assert.equal(bridge.normalizeSidePanelTab(undefined), 'create');
  });

  it('任务描述草稿使用固定 session 键', () => {
    assert.equal(bridge.createDescStorageKey(), 'sidePanelCreateDesc');
  });

  it('打不开侧边栏时的提示按语言区分', () => {
    assert.match(bridge.sidePanelOpenHint('zh-CN'), /展开或收起侧边栏/);
    assert.match(bridge.sidePanelOpenHint('en'), /open or close the side panel/);
    assert.doesNotMatch(bridge.sidePanelOpenHint('en'), /侧边栏/);
  });

  it('工具栏图标交给浏览器展开或收起侧边栏', () => {
    assert.deepEqual(bridge.toolbarActionPanelBehavior(), { openPanelOnActionClick: true });
  });

  it('图标打开切到设置，页面消息刚打开时不覆盖页签', () => {
    const now = 10000;
    assert.equal(bridge.iconOpenShouldSelectSettings(null, now), true);
    assert.equal(bridge.iconOpenShouldSelectSettings({ kind: 'message', at: now - 100 }, now), false);
    assert.equal(bridge.iconOpenShouldSelectSettings({ kind: 'message', at: now - 2000 }, now), true);
  });

  it('图标打开固定设置；填入或悬浮球消息在 2 秒内保留创建页', () => {
    const now = 10000;
    const fresh = { kind: 'message', at: now - 100, which: 'create' };
    assert.equal(bridge.resolveSidePanelOnShow(null, 'create', now), 'settings');
    assert.equal(bridge.resolveSidePanelOnShow(fresh, 'create', now), 'create');
    assert.equal(bridge.resolveSidePanelOnShow({ kind: 'message', at: now - 2000 }, 'create', now), 'settings');
    assert.equal(bridge.resolveSidePanelIntent(fresh, null, 'settings', now), 'create');
    assert.equal(bridge.resolveSidePanelIntent(null, null, 'create', now), 'settings');
    assert.equal(
      bridge.resolveSidePanelIntent({ kind: 'message', which: 'create', at: now - 2000 }, null, 'settings', now),
      'settings',
    );
  });
});

describe('side panel manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

  it('去掉工具栏 popup，改为侧边栏', () => {
    assert.equal(manifest.action.default_popup, undefined);
    assert.ok(manifest.permissions.includes('sidePanel'));
    assert.equal(manifest.side_panel.default_path, 'sidepanel/sidepanel.html');
  });

  it('工具栏点击用 setPanelBehavior 切换，不再用 onClicked 只打开', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'background', 'sw-side-panel.js'), 'utf8');
    assert.match(src, /setPanelBehavior\(SidePanelBridge\.toolbarActionPanelBehavior\(\)\)/);
    assert.doesNotMatch(src, /action\.onClicked/);
  });

  it('创建任务与设置页签背景为白色，设置 iframe 铺满宽度', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.css'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.html'), 'utf8');
    const settingsCss = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup-sidepanel.css'), 'utf8');
    assert.match(css, /\.sp-tab[\s\S]*background:\s*#fff/);
    assert.match(css, /\.sp-pane[\s\S]*background:\s*#fff/);
    assert.match(css, /#taskplugin-float-panel[\s\S]*background:\s*#fff/);
    assert.match(html, /popup\.html\?host=sidepanel/);
    assert.match(settingsCss, /width:\s*100%/);
    assert.match(settingsCss, /background:\s*#fff/);
  });
});

// OPT-20260929-014：侧边栏设置页此前按类名逐条把深色块改成白底，
// popup.css / popup-guide.css 新增的深色块会漏网。
// 现在由一层 `body *:not(:where(控件))` 兜底，测试负责盯住两件事：
// 控件色确实被排除、以及白底元素不会被留下浅色前景（白底白字）。
const DARK_SURFACE_TOKENS = ['#1e1e2e', '#181825', '#11111b', '#252536', '#313244', '#45475a'];
const LIGHT_TEXT_TOKENS = ['#cdd6f4', '#e0e0e0', '#bac2de', '#a6adc8'];
const CONTROL_SELECTORS = [
  '.btn-primary', '.btn-danger', '.btn-link',
  '.badge-connected', '.badge-disconnected', '.badge-warning',
  '.req-method', '.req-status', '.result', '.toggle-slider', 'kbd', '.tcp-guide-kbd',
];

function cssRules(css) {
  const rules = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!selector || selector.startsWith('@')) continue;
    rules.push({ selector, decls: match[2] });
  }
  return rules;
}

function classTokens(selector) {
  return [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
}

describe('side panel light surface layer', () => {
  const popupDir = path.join(__dirname, '..', 'popup');
  const settingsCss = fs.readFileSync(path.join(popupDir, 'popup-sidepanel.css'), 'utf8');
  const popupCss = fs.readFileSync(path.join(popupDir, 'popup.css'), 'utf8');
  const guideCss = fs.readFileSync(path.join(popupDir, 'popup-guide.css'), 'utf8');

  it('用一层 body *:not(:where(控件)) 铺白底', () => {
    const blanket = /body \*:not\(:where\(([\s\S]*?)\)\)[\s\S]*?\{([\s\S]*?)\}/.exec(settingsCss);
    assert.ok(blanket, '设置页应有 body *:not(:where(...)) 通配覆盖');
    const exclusions = blanket[1].split(',').map((item) => item.trim()).filter(Boolean);
    assert.match(blanket[2], /background:\s*#fff/);
    assert.ok(exclusions.includes('kbd'), 'kbd 芯片保留深色主题配色');
    assert.ok(exclusions.includes('.btn-primary'), '主按钮保留强调色');
    assert.ok(exclusions.includes('.badge-connected') && exclusions.includes('.req-method'));
  });

  it('深色底选择器要么是控件色，要么被覆盖并且有深色前景', () => {
    const blanket = /body \*:not\(:where\(([\s\S]*?)\)\)/.exec(settingsCss);
    const exclusions = blanket[1].split(',').map((item) => item.trim()).filter(Boolean);

    const darkTextClasses = new Set();
    let darkTextSelectors = '';
    for (const rule of cssRules(settingsCss)) {
      if (!/color:\s*#1e1e2e/.test(rule.decls)) continue;
      darkTextSelectors += ` ${rule.selector} `;
      for (const cls of classTokens(rule.selector)) darkTextClasses.add(cls);
    }

    const seen = [];
    for (const rule of cssRules(`${popupCss}\n${guideCss}`)) {
      const dark = DARK_SURFACE_TOKENS.some((token) => rule.decls.includes(token))
        || /linear-gradient\(/.test(rule.decls);
      if (!dark) continue;
      for (const part of rule.selector.split(',').map((item) => item.trim()).filter(Boolean)) {
        seen.push(part);
        const control = CONTROL_SELECTORS.find((token) => part.includes(token));
        if (control) {
          assert.ok(
            exclusions.some((item) => part.includes(item)),
            `控件色 ${part} 应出现在侧边栏排除表`,
          );
          continue;
        }
        for (const item of exclusions) {
          assert.ok(
            !part.includes(item),
            `表面元素 ${part} 不该被排除（${item}），否则深色块会漏进设置页`,
          );
        }
        if (LIGHT_TEXT_TOKENS.some((token) => rule.decls.includes(token))) {
          const classes = classTokens(part);
          const covered = classes.length
            ? classes.some((cls) => darkTextClasses.has(cls))
            : darkTextSelectors.includes(part);
          assert.ok(covered, `白底元素 ${part} 需要深色前景规则，否则白底白字`);
        }
      }
    }
    assert.ok(seen.includes('.section') && seen.includes('.popup-req-detail'), '样例选择器应被扫到');
  });
});

describe('float markup host split', () => {
  const markup = require('../lib/float-panel-markup.js');

  it('页面只留悬浮球和元素调整框', () => {
    const html = markup.html('page');
    assert.match(html, /id="taskplugin-float-btn"/);
    assert.match(html, /id="taskplugin-adjust-modal"/);
    assert.doesNotMatch(html, /id="taskplugin-float-panel"/);
    assert.doesNotMatch(html, /id="taskplugin-desc"/);
  });

  it('侧边栏创建页签只有表单', () => {
    const html = markup.html('form');
    assert.match(html, /id="taskplugin-float-panel"/);
    assert.match(html, /id="taskplugin-desc"/);
    assert.match(html, /id="taskplugin-submit"/);
    assert.doesNotMatch(html, /id="taskplugin-float-btn"/);
  });
});
