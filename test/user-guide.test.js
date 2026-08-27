'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const UserGuide = require('../lib/user-guide.js');

const REQUIRED_IDS = [
  'overview',
  'login',
  'float-create',
  'element-pick',
  'devtools-single',
  'devtools-batch',
  'popup-extras',
  'keyboard-shortcuts',
];

describe('UserGuide sections', () => {
  it('exposes required section ids', () => {
    const ids = UserGuide.listSectionIds();
    for (const id of REQUIRED_IDS) {
      assert.ok(ids.includes(id), `missing section id: ${id}`);
    }
  });

  it('filters sections by surface', () => {
    const floatIds = UserGuide.getSectionsForSurface('float').map((s) => s.id);
    assert.ok(floatIds.includes('element-pick'));
    assert.ok(floatIds.includes('float-create'));
    assert.ok(!floatIds.includes('popup-extras'));

    const popupIds = UserGuide.getSectionsForSurface('popup').map((s) => s.id);
    assert.ok(popupIds.includes('popup-extras'));
    assert.ok(popupIds.includes('login'));
  });

  it('renderCollapsibleHtml includes surface and section markers', () => {
    const html = UserGuide.renderCollapsibleHtml({ surface: 'float', open: false });
    assert.match(html, /data-guide-surface="float"/);
    assert.match(html, /data-guide-id="element-pick"/);
    assert.match(html, /使用说明/);
    assert.match(html, /Ctrl|⌘|多选/);
    assert.doesNotMatch(html, /Shift\+点击/);
  });

  it('float-create 说明包含同名工作空间按公司名区分', () => {
    const html = UserGuide.renderCollapsibleHtml({ surface: 'float', open: false });
    assert.match(html, /名称 · 公司名/);
  });

  it('float-create 说明包含项目是否可自动运行标注', () => {
    const html = UserGuide.renderCollapsibleHtml({ surface: 'float', open: false });
    assert.match(html, /可自动运行/);
    assert.match(html, /不可自动运行/);
  });

  it('T17 float-create 项目为单选且自动运行随项目能力', () => {
    const html = UserGuide.renderCollapsibleHtml({ surface: 'float', open: false });
    assert.match(html, /项目（单选）/);
    assert.doesNotMatch(html, /项目（可多选）/);
    assert.match(html, /所选项目是否允许自动运行/);
    assert.match(html, /已安装镜像才能勾选/);
    const md = fs.readFileSync(path.join(__dirname, '../docs/USER_GUIDE.md'), 'utf8');
    assert.match(md, /项目（单选）/);
    assert.doesNotMatch(md, /与项目（可多选）/);
    assert.match(md, /已安装镜像才能勾选/);
  });

  it('float-create 说明包含面板顶部 × 关闭浮窗', () => {
    const html = UserGuide.renderCollapsibleHtml({ surface: 'float', open: false });
    assert.match(html, /面板顶部[「"]×[」"]/);
    assert.match(html, /关闭浮窗/);
    assert.doesNotMatch(html, /面板顶部[「"]×[」"].*关闭悬浮球/);
  });

  it('renderFullGuideHtml for panel includes batch section', () => {
    const html = UserGuide.renderFullGuideHtml({ surface: 'panel' });
    assert.match(html, /data-guide-id="devtools-batch"/);
    assert.match(html, /5xx/);
  });

  it('devtools-single mentions request body is written into the task description', () => {
    const html = UserGuide.renderFullGuideHtml({ surface: 'panel' });
    assert.match(html, /请求体/);
  });

  it('escapeHtml escapes angle brackets', () => {
    assert.equal(UserGuide.escapeHtml('<script>'), '&lt;script&gt;');
  });

  it('快捷键说明按用户自定义的组合动态插值（默认 Ctrl+Shift+X）', () => {
    // 默认（未选择）→ Ctrl+Shift+X 文案
    UserGuide.setShortcutMode('');
    const generic = UserGuide.renderCollapsibleHtml({ surface: 'popup' });
    assert.match(generic, /Ctrl\+Shift\+X/);

    // 旧版 'cmd' 迁移 → Command+Shift+X
    UserGuide.setShortcutMode('cmd');
    const cmdHtml = UserGuide.renderCollapsibleHtml({ surface: 'popup' });
    assert.match(cmdHtml, /Command\+Shift\+X/);

    // 旧版 'ctrl' → Ctrl+Shift+X
    UserGuide.setShortcutMode('ctrl');
    const ctrlHtml = UserGuide.renderFullGuideHtml({ surface: 'panel' });
    assert.match(ctrlHtml, /Ctrl\+Shift\+X/);

    // 自定义组合 → 实际组合串（首条步骤跟随）
    UserGuide.setShortcutMode('Alt+Shift+E');
    const customHtml = UserGuide.renderCollapsibleHtml({ surface: 'popup' });
    assert.match(customHtml, /Alt\+Shift\+E：切换指针选择模式/);

    // 非法值忽略，回退默认 Ctrl+Shift+X 文案
    UserGuide.setShortcutMode('weird');
    const fallback = UserGuide.renderCollapsibleHtml({ surface: 'float' });
    assert.match(fallback, /Ctrl\+Shift\+X/);
    UserGuide.setShortcutMode('');
  });
});

describe('USER_GUIDE.md sync', () => {
  it('documents every section id from user-guide.js', () => {
    const mdPath = path.join(__dirname, '../docs/USER_GUIDE.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    for (const id of UserGuide.listSectionIds()) {
      assert.ok(md.includes(`\`${id}\``) || md.includes(id), `USER_GUIDE.md missing id ${id}`);
    }
  });
});
