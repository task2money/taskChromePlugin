'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contentJs = fs.readFileSync(
  path.join(__dirname, '..', 'content', 'content.js'),
  'utf8'
);
const contentCss = fs.readFileSync(
  path.join(__dirname, '..', 'content', 'content.css'),
  'utf8'
);

// content.js 为 IIFE 内容脚本（顶层立即操作 DOM），无法直接 require；
// 回归测试采用源码契约断言：修复后默认提示语必须来自 ElementPicker.DEFAULT_ADJUST_PROMPT，
// 且旧硬编码文案不得残留。修复前（硬编码 '请解决问题' 存在）断言 1 失败，可复现缺陷。
describe('content.js 调整期望输入框默认提示语', () => {
  it('不再硬编码旧文案「请解决问题」', () => {
    assert.ok(
      !contentJs.includes("'请解决问题'"),
      'content.js 不应残留旧默认提示语硬编码'
    );
  });

  it('默认提示语引用 ElementPicker.DEFAULT_ADJUST_PROMPT', () => {
    assert.ok(
      contentJs.includes('adjustInput.value = ElementPicker.DEFAULT_ADJUST_PROMPT'),
      'openAdjustModal 默认值应来自 ElementPicker.DEFAULT_ADJUST_PROMPT 常量'
    );
  });
});

// OPT-20260821-008: Popup 悬浮球开关只写 storage，content 监听 onChanged 自更新。
describe('content.js 悬浮球 storage 变更监听', () => {
  it('存在 bindFloatBallStorageListener', () => {
    assert.ok(contentJs.includes('function bindFloatBallStorageListener'), 'content.js 应监听 floatBallEnabled storage 变更');
  });

  it('监听 floatBallEnabled 键并更新显隐', () => {
    assert.ok(contentJs.includes('changes.floatBallEnabled'), '应检查 floatBallEnabled 变更');
    assert.ok(contentJs.includes("setProperty('display', enabled ? 'block' : 'none'"), '应据变更更新悬浮球显隐');
  });
});

describe('content.js 元素拾取快捷键提示语（平台默认分派）', () => {
  it('静态 placeholder 为平台中立文案，不再硬编码 Ctrl+Shift+X', () => {
    assert.ok(
      /id="taskplugin-desc"[^>]*placeholder="[^"]*按快捷键/.test(contentJs),
      'placeholder 应平台中立（按快捷键…），由 renderShortcutHints 按平台渲染实际组合',
    );
    const phIdx = contentJs.indexOf('id="taskplugin-desc"');
    assert.ok(phIdx >= 0);
    assert.doesNotMatch(contentJs.slice(phIdx, phIdx + 400), /Ctrl\+Shift\+X/, '静态 placeholder 不应残留硬编码 Ctrl+Shift+X');
  });

  it('renderShortcutHints 兜底回退平台默认（detectDefaultShortcut），mac 不误显示 Ctrl', () => {
    assert.match(
      contentJs,
      /pickShortcutCombo \|\| Storage\.detectDefaultShortcut\(\)/,
      'hint 文案兜底应平台分派，而非硬编码 Ctrl+Shift+X',
    );
    assert.match(
      contentJs,
      /let pickShortcutCombo = Storage\.detectDefaultShortcut\(\)/,
      '页内兜底初始组合应取平台默认（mac ⌘+Shift+X / 其他 Ctrl+Shift+X）',
    );
  });
});

describe('content.js 浮窗面板顶部 × 仅关闭面板', () => {
  it('面板 header 含 type=button 的 × 关闭按钮', () => {
    assert.match(contentJs, /id="taskplugin-float-close"/);
    assert.match(
      contentJs,
      /class="taskplugin-panel-header"[\s\S]*id="taskplugin-float-close"/,
      '关闭按钮须在悬浮面板顶部 header 内'
    );
    assert.match(contentJs, /<button[^>]*id="taskplugin-float-close"[^>]*type="button"/);
    assert.match(contentJs, /aria-label="关闭浮窗"/);
  });

  it('点击 × 只收起面板，不隐藏悬浮球、不写 floatBallEnabled', () => {
    const closeIdx = contentJs.indexOf("getElementById('taskplugin-float-close')");
    assert.ok(closeIdx >= 0, '应绑定 #taskplugin-float-close');
    const bindSlice = contentJs.slice(closeIdx, closeIdx + 900);
    assert.match(bindSlice, /addEventListener\(\s*['"]click['"]/);
    assert.match(bindSlice, /hideFloatPanel\(\)/);
    assert.doesNotMatch(bindSlice, /saveFloatBallConfigToStorage/);
    assert.doesNotMatch(bindSlice, /setProperty\(\s*['"]display['"]/);
  });

  it('关闭按钮有独立样式且标注纯 UI 防重放', () => {
    assert.match(contentCss, /#taskplugin-float-close\b/);
    assert.match(contentJs, /Anti-Replay-OK:\s*ui-only/);
  });
});
