'use strict';

/**
 * pick-frame.js 元素拾取快捷键默认值回归测试（源契约断言）
 * pick-frame.js 为 IIFE 内容脚本（all_frames 子 frame），无法直接 require；
 * 与 content.test.js 同款策略：断言源码契约。
 *
 * 默认统一 Alt+X（2026-09-11）；旧版 cmd/ctrl 迁移仍保留。
 * 子 frame 内按键不冒泡到顶层，content.js 的顶层 keydown 兜底在子 frame
 * 聚焦时不触发（OPT-20260806-016），pick-frame 自带默认兜底组合。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pickFrame = fs.readFileSync(
  path.join(__dirname, '..', 'content', 'pick-frame.js'),
  'utf8',
);

describe('pick-frame.js 页内兜底快捷键默认组合（统一 Alt+X）', () => {
  it('初始组合为 Alt+X', () => {
    assert.match(
      pickFrame,
      /let pickShortcutCombo = 'Alt\+X';/,
      '初始组合应为统一默认 Alt+X',
    );
  });

  it('storage 配置加载失败时保持默认 Alt+X', () => {
    assert.match(
      pickFrame,
      /保持默认 Alt\+X/,
      'catch 注释应表明保持默认 Alt+X',
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
