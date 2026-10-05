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

  // 本机模型页签在侧栏宿主直接渲染（非设置 iframe），若只引 popup.css 会吃到 #1e1e2e。
  it('本机模型页签宿主须加载 popup-sidepanel 浅色覆盖（在 popup.css 之后）', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.html'), 'utf8');
    assert.match(html, /data-taskplugin-host="sidepanel"/);
    assert.match(html, /id="sp-pane-builtin"/);
    const popupCss = html.indexOf('href="../popup/popup.css"');
    const lightCss = html.indexOf('href="../popup/popup-sidepanel.css"');
    assert.ok(popupCss >= 0, 'sidepanel 须引用 popup.css');
    assert.ok(lightCss >= 0, 'sidepanel 须引用 popup-sidepanel.css，否则本机模型区仍为深色底');
    assert.ok(lightCss > popupCss, 'popup-sidepanel.css 须排在 popup.css 之后以覆盖深色底');
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
  // 使用说明展开 CTA：侧栏保留青底强调色，不铺白
  '.tcp-guide-root-summary',
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
    assert.match(blanket[2], /background:\s*#fff\s*!important/);
    assert.ok(exclusions.includes('kbd'), 'kbd 芯片保留深色主题配色');
    assert.ok(exclusions.includes('.btn-primary'), '主按钮保留强调色');
    assert.ok(exclusions.includes('.badge-connected') && exclusions.includes('.req-method'));
    assert.ok(
      exclusions.some((item) => item.includes('tcp-guide-root-summary')),
      '使用说明主 CTA 保留强调色',
    );
  });

  it('popup-sidepanel.css 须在 popup-guide.css 之后加载，且钉死使用说明深色块', () => {
    const popupHtml = fs.readFileSync(path.join(popupDir, 'popup.html'), 'utf8');
    const guideAt = popupHtml.indexOf('href="popup-guide.css"');
    const lightAt = popupHtml.indexOf('href="popup-sidepanel.css"');
    assert.ok(guideAt >= 0 && lightAt > guideAt, '浅色层须在 guide 之后，否则 #popup-user-guide 深色底会漏网');
    assert.match(
      settingsCss,
      /#popup-user-guide\s+\.tcp-guide-body[\s\S]*?background:\s*#fff\s*!important/,
    );
    assert.match(settingsCss, /\.popup-req-detail[\s\S]*?background:\s*#fff\s*!important/);
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

  it('页面只留元素调整框，不注入悬浮球', () => {
    const html = markup.html('page');
    assert.doesNotMatch(html, /id="taskplugin-float-btn"/);
    assert.match(html, /id="taskplugin-adjust-modal"/);
    assert.doesNotMatch(html, /id="taskplugin-float-panel"/);
    assert.doesNotMatch(html, /id="taskplugin-desc"/);
  });

  it('侧边栏创建页签只有表单', () => {
    const html = markup.html('form');
    assert.match(html, /id="taskplugin-float-panel"/);
    assert.match(html, /id="taskplugin-desc"/);
    assert.match(html, /id="taskplugin-submit"/);
    assert.match(html, /id="taskplugin-desc-reset"/);
    assert.match(html, /taskplugin-btn-reset/);
    assert.doesNotMatch(html, /id="taskplugin-float-btn"/);
  });
});

describe('sidepanel create-form contrast overrides', () => {
  const sidepanelCss = fs.readFileSync(
    path.join(__dirname, '..', 'sidepanel', 'sidepanel.css'),
    'utf8',
  );
  const formCss = fs.readFileSync(
    path.join(__dirname, '..', 'content', 'content-form.css'),
    'utf8',
  );
  const host = 'html\\[data-taskplugin-host="sidepanel"\\]';
  // 深色浮窗浅字 + 结果条/hint 在白底侧栏需覆盖；保留深色底控件（如 .taskplugin-btn）
  const FORM_LIGHT_TOKENS = [...LIGHT_TEXT_TOKENS, '#6c7086', '#a6e3a1', '#f38ba8'];
  const READABLE_DARK = ['#1e1e2e', '#4b5563', '#166534', '#b91c1c'];
  const FORM_EXCLUDE = /adjust-modal|page-toast|taskplugin-picking|modal-card|modal-el|shot-label|btn-primary|result-dismiss|result a|\ba\b|:focus/;

  function declsFor(selectorFrag) {
    // 允许多选择器规则：frag 后可跟 `, ...` 再 `{`
    const re = new RegExp(
      `${host}\\s+${selectorFrag}\\s*(?:,[^{]*)?\\{([^}]+)\\}`,
      'm',
    );
    const m = re.exec(sidepanelCss);
    assert.ok(m, `missing rule for ${selectorFrag}`);
    return m[1];
  }

  function sidepanelCovers(selectorPart) {
    const classes = classTokens(selectorPart);
    const ids = [...selectorPart.matchAll(/#([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    for (const rule of cssRules(sidepanelCss)) {
      if (!rule.selector.includes('data-taskplugin-host="sidepanel"')) continue;
      if (!READABLE_DARK.some((c) => new RegExp(`color:\\s*${c}`, 'i').test(rule.decls))) {
        continue;
      }
      const hitClass = classes.some((cls) => new RegExp(`\\.${cls}(?:\\W|$)`).test(rule.selector));
      const hitId = ids.some((id) => rule.selector.includes(`#${id}`));
      const hitLegend = /legend/.test(selectorPart) && /legend/.test(rule.selector);
      if (hitClass || hitId || hitLegend) return true;
    }
    return false;
  }

  function keepsDarkSurface(decls) {
    return DARK_SURFACE_TOKENS.some((token) => decls.includes(token));
  }

  function sidepanelFlattensSurface(selectorPart) {
    const classes = classTokens(selectorPart);
    for (const rule of cssRules(sidepanelCss)) {
      if (!rule.selector.includes('data-taskplugin-host="sidepanel"')) continue;
      if (!/background:\s*#fff|#f1f2f6|#f9fafb|rgba\(22,\s*101,\s*52|rgba\(185,\s*28,\s*28/i.test(rule.decls)) {
        continue;
      }
      if (classes.some((cls) => new RegExp(`\\.${cls}(?:\\W|$)`).test(rule.selector))) {
        return true;
      }
    }
    return false;
  }

  it('重置按钮在浅色宿主用深色字 + 浅底', () => {
    const decls = declsFor('\\.taskplugin-btn-reset');
    assert.match(decls, /color:\s*#1e1e2e\s*!important/);
    assert.match(decls, /background:\s*#f1f2f6\s*!important/);
    assert.match(decls, /border-color:\s*#d0d0d8\s*!important/);
  });

  it('重置按钮 hover 保持深色字（不回退粉红浅字）', () => {
    const decls = declsFor('\\.taskplugin-btn-reset:hover:not\\(:disabled\\)');
    assert.match(decls, /color:\s*#1e1e2e\s*!important/);
    assert.doesNotMatch(decls, /#f38ba8/);
  });

  it('重置按钮 disabled 仍用可读灰字', () => {
    const decls = declsFor('\\.taskplugin-btn-reset:disabled');
    assert.match(decls, /color:\s*#4b5563\s*!important/);
    assert.match(decls, /opacity:\s*0\.55\s*!important/);
  });

  it('项目单选列表 label 覆盖深色浮窗浅字', () => {
    const decls = declsFor('\\.taskplugin-checkbox-list\\s+label');
    assert.match(decls, /color:\s*#1e1e2e\s*!important/);
  });

  it('fieldset legend / hint / 结果条有侧栏深色字覆盖', () => {
    assert.match(declsFor('legend'), /color:\s*#1e1e2e\s*!important/);
    assert.match(declsFor('\\.taskplugin-toggle-hint'), /color:\s*#4b5563\s*!important/);
    assert.match(declsFor('\\.taskplugin-result-success'), /color:\s*#166534\s*!important/);
    assert.match(declsFor('\\.taskplugin-result-error'), /color:\s*#b91c1c\s*!important/);
  });

  it('content-form.css 浅字选择器相对侧栏覆盖差集为空', () => {
    const gaps = [];
    for (const rule of cssRules(formCss)) {
      if (!FORM_LIGHT_TOKENS.some((token) => rule.decls.toLowerCase().includes(token))) continue;
      for (const part of rule.selector.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (FORM_EXCLUDE.test(part)) continue;
        // 深色底控件若侧栏未铺白，浅字仍可读，不算缺口
        if (keepsDarkSurface(rule.decls) && !sidepanelFlattensSurface(part)) continue;
        if (sidepanelCovers(part)) continue;
        gaps.push(part);
      }
    }
    assert.deepEqual(gaps, [], `uncovered light-text selectors: ${gaps.join(' | ')}`);
  });
});
