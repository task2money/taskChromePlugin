'use strict';

/**
 * 快捷键 (Ctrl/⌘+Shift+X) 三层链路静态测试
 *
 * 覆盖 chrome.commands 注册 → SW 转发 → content script 处理的完整链路，
 * 以及「页内 keydown 兜底」修复（chrome.commands 注册失败时保证快捷键仍可用）。
 * 防止任一环节被后续改动无意破坏。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const COMMAND_NAME = 'toggle-element-picker';
const MESSAGE_ACTION = 'toggleElementPick';
const SHORTCUT_KEY_HINT = 'Ctrl+Shift+X';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const manifest = JSON.parse(read('manifest.json'));
const sw = read('background/service-worker.js');
const content = read('content/content.js');
const popupHtml = read('popup/popup.html');
const popupJs = read('popup/popup.js');
const userGuideMd = read('docs/USER_GUIDE.md');
const userGuideJs = read('lib/user-guide.js');

describe('键盘快捷键三层链路', () => {
  it('manifest 注册 toggle-element-picker 命令及 Ctrl/⌘+Shift+X 建议键位', () => {
    assert.ok(manifest.commands, 'manifest.commands 缺失');
    const cmd = manifest.commands[COMMAND_NAME];
    assert.ok(cmd, `manifest.commands 缺少 ${COMMAND_NAME}`);
    assert.equal(cmd.suggested_key.default, SHORTCUT_KEY_HINT);
    assert.equal(cmd.suggested_key.mac, 'Command+Shift+X');
    assert.ok(cmd.description);
  });

  it('service-worker 注册 onCommand 并转发 toggleElementPick 到活动 tab', () => {
    assert.match(sw, /chrome\.commands\.onCommand\.addListener/);
    assert.ok(sw.includes(COMMAND_NAME), 'SW 中缺少命令名 ' + COMMAND_NAME);
    assert.ok(sw.includes(MESSAGE_ACTION), 'SW 中缺少转发消息 ' + MESSAGE_ACTION);
    assert.match(sw, /chrome\.tabs\.query\(\{\s*active: true,\s*currentWindow: true/);
    // 顶层 frame 失败时回退整 tab 广播（修复：受限页/注入竞态下快捷键依然生效）
    assert.match(sw, /frame0 失败，回退整 tab 广播/, 'SW 缺少 frame0 回退逻辑');
    assert.match(sw, /chrome\.tabs\.sendMessage\(tabId,\s*\{\s*action: 'toggleElementPick'\s*\}\)\s*;/);
  });

  it('content.js 注册页内 keydown 兜底监听（chrome.commands 注册失败时的保证）', () => {
    assert.ok(content.includes('SHORTCUT_DEBOUNCE_MS'), '缺少去抖常量');
    assert.ok(content.includes('togglePickModeFromShortcut'), '缺少兜底切换函数');
    assert.ok(content.includes('onShortcutKeyDown'), '缺少 keydown 兜底处理器');
    assert.ok(
      /document\.addEventListener\('keydown', onShortcutKeyDown, true\)/.test(content),
      '兜底 keydown 监听未以捕获阶段注册到 document',
    );
    // 仅在 Cmd/Ctrl + Shift + X 时触发，忽略重复事件
    assert.match(content, /e\.metaKey \|\| e\.ctrlKey/);
    assert.match(content, /e\.shiftKey/);
    assert.match(content, /k !== 'x' && k !== 'X'/);
    assert.match(content, /e\.repeat/);
    assert.ok(
      content.includes('lastShortcutToggleAt < SHORTCUT_DEBOUNCE_MS'),
      '兜底切换缺少与消息路径共享的去抖保护（防双触发）',
    );
  });

  it('content.js 消息处理器与兜底监听共享去抖时间戳', () => {
    const msgBlock = content.slice(content.indexOf("msg.action === 'toggleElementPick'"));
    assert.ok(msgBlock.startsWith("msg.action === 'toggleElementPick'"));
    assert.ok(msgBlock.includes("setPickMode(nextPickMode, 'float')"));
    // 消息路径同样受去抖保护：同一次按键双触发（浏览器命令 + 事件穿透）不会重复切换
    assert.ok(
      msgBlock.includes('now - lastShortcutToggleAt >= SHORTCUT_DEBOUNCE_MS'),
      '消息路径缺少去抖保护',
    );
    assert.ok(msgBlock.includes('debounced: true'), '消息路径缺少 debounced 回执');
  });

  it('popup 提供 chrome://extensions/shortcuts 排查入口', () => {
    assert.ok(popupHtml.includes('taskplugin-shortcut-settings'), 'popup.html 缺少排查链接');
    assert.ok(popupHtml.includes('chrome://extensions/shortcuts'));
    assert.ok(popupJs.includes("'chrome://extensions/shortcuts'"), 'popup.js 缺少跳转处理');
    assert.match(popupJs, /chrome\.tabs\.create\(\{\s*url: 'chrome:\/\/extensions\/shortcuts'\s*\}\)/);
  });

  it('文档说明快捷键无效时的排查路径', () => {
    assert.ok(userGuideMd.includes('chrome://extensions/shortcuts'), 'USER_GUIDE.md 缺少排查说明');
    assert.ok(
      userGuideJs.includes('chrome://extensions/shortcuts'),
      'user-guide.js 缺少排查说明',
    );
  });
});
