'use strict';

/**
 * pick-frame.js 元素拾取快捷键平台分派回归测试（源契约断言）
 * pick-frame.js 为 IIFE 内容脚本（all_frames 子 frame），无法直接 require；
 * 与 content.test.js 同款策略：断言源码契约。
 *
 * 缺陷背景（2026-08-24 修复）：页内兜底快捷键默认值须平台分派 —
 *   macOS → 'Command+Shift+X'，Windows/Linux → 'Ctrl+Shift+X'。
 * 子 frame 内按键不冒泡到顶层，content.js 的顶层 keydown 兜底在子 frame
 * 聚焦时不触发（OPT-20260806-016），pick-frame 自带平台探测初始兜底组合。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pickFrame = fs.readFileSync(
  path.join(__dirname, '..', 'content', 'pick-frame.js'),
  'utf8',
);

describe('pick-frame.js 页内兜底快捷键默认组合（平台分派）', () => {
  it('初始组合按平台分派：mac → ⌘+Shift+X，Win/Linux → Ctrl+Shift+X', () => {
    assert.match(
      pickFrame,
      /plat\.includes\('mac'\) \? 'Command\+Shift\+X' : 'Ctrl\+Shift\+X'/,
      '初始组合应按平台分派（mac → ⌘+Shift+X，其他 → Ctrl+Shift+X）',
    );
  });

  it('平台探测覆盖 userAgentData / platform / userAgent 形态', () => {
    assert.match(
      pickFrame,
      /navigator\?\.platform \|\| navigator\?\.userAgent/,
      '平台探测应覆盖 userAgentData / platform / userAgent',
    );
  });

  it('storage 配置加载失败时保持平台默认（不硬编码 Ctrl 回退）', () => {
    // 初始值即平台分派结果；catch 路径不覆写，注释语义为「保持平台默认」
    assert.match(
      pickFrame,
      /navigator\?\.platform \|\| navigator\?\.userAgent[\s\S]{0,400}Command\+Shift\+X/,
      '初始默认计算须先于任何可能抛错的读取',
    );
    assert.match(
      pickFrame,
      /保持平台默认/,
      'catch 注释应表明保持平台默认而非硬编码 Ctrl+Shift+X',
    );
  });

  it('storage 变更监听与旧版 cmd/ctrl 迁移逻辑一致', () => {
    assert.match(pickFrame, /changes\.elementPickerShortcut/);
    assert.match(
      pickFrame,
      /v === 'cmd' \? 'Command\+Shift\+X' : v === 'ctrl' \? 'Ctrl\+Shift\+X'/,
      '旧版 cmd/ctrl 迁移应与 Storage.getElementPickerShortcut 一致',
    );
  });
});
