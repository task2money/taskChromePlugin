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
const { readContentBundle } = require('./helpers/contentBundle.js');
const content = readContentBundle();
const pickFrame = read('content/pick-frame.js');
const popupHtml = read('popup/popup.html');
const popupJs = read('popup/popup.js');
const userGuideMd = read('docs/USER_GUIDE.md');
const userGuideJs = read('lib/user-guide.js');

describe('键盘快捷键三层链路', () => {
  it('manifest 注册 toggle-element-picker 命令及建议键位（默认 mac ⌘+Shift+X / 其他 Ctrl+Shift+X）', () => {
    assert.ok(manifest.commands, 'manifest.commands 缺失');
    const cmd = manifest.commands[COMMAND_NAME];
    assert.ok(cmd, `manifest.commands 缺少 ${COMMAND_NAME}`);
    assert.equal(cmd.suggested_key.default, SHORTCUT_KEY_HINT);
    // Command 修饰键仅 macOS 有效；mac 默认 ⌘+Shift+X（用户要求），其他平台 Ctrl+Shift+X
    assert.equal(cmd.suggested_key.mac, 'Command+Shift+X');
    assert.ok(cmd.description);
  });

  it('content.js 页内兜底初始组合取平台默认（Storage.detectDefaultShortcut）', () => {
    assert.match(
      content,
      /var pickShortcutCombo = Storage\.detectDefaultShortcut\(\)/,
      'content 兜底初始组合应为平台默认，而非硬编码 Ctrl+Shift+X',
    );
    assert.match(
      content,
      /pickShortcutCombo \|\| Storage\.detectDefaultShortcut\(\)/,
      'hint 文案兜底应平台分派',
    );
  });

  it('popup 静态键位锚点为平台中立，默认组合文案按平台注明（mac ⌘ / 其他 Ctrl）', () => {
    assert.ok(popupHtml.includes('⌘/Ctrl+Shift+X'), '静态 kbd 应为平台中立 ⌘/Ctrl+Shift+X（JS 按平台渲染）');
    assert.match(popupHtml, /默认 Mac 为 ⌘\+Shift\+X、其他系统为 Ctrl\+Shift\+X/, 'popup 说明应注明平台默认差异');
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
    // 组合串模型（默认 Ctrl+Shift+X，Popup 可自定义任意组合），严格匹配由 Storage.matchShortcutKeydown 承担
    assert.ok(content.includes('pickShortcutCombo'), '缺少快捷键组合串变量');
    assert.match(
      content,
      /Storage\.matchShortcutKeydown\(e, pickShortcutCombo\)/,
      '兜底未使用严格组合匹配',
    );
    assert.match(content, /e\.repeat/);
    assert.ok(
      content.includes('renderShortcutHints'),
      '缺少快捷键提示文案同步函数',
    );
    assert.ok(
      content.includes('lastShortcutToggleAt < SHORTCUT_DEBOUNCE_MS'),
      '兜底切换缺少与消息路径共享的去抖保护（防双触发）',
    );
  });

  it('content.js 支持 Popup 自定义快捷键并实时生效（storage.onChanged）', () => {
    assert.doesNotMatch(
      content,
      /msg\.action === 'setElementPickerShortcut'/,
      'content 不应再接收跨 tab 快捷键消息',
    );
    assert.ok(
      content.includes('bindStorageListeners'),
      '缺少快捷键 storage 变更监听',
    );
    assert.ok(
      content.includes('changes.elementPickerShortcut'),
      'storage 监听未读取 elementPickerShortcut 变更',
    );
    assert.ok(
      content.includes('pickShortcutCombo = await Storage.getElementPickerShortcut()'),
      '初始化未加载快捷键配置',
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

  it('popup 提供快捷键自定义 UI（按键捕获 + 恢复默认）并经 SW 改绑', () => {
    // 自定义行 + 动态键位展示锚点
    assert.ok(popupHtml.includes('id="btnPickShortcutEdit"'), 'popup.html 缺少「修改」按钮');
    assert.ok(popupHtml.includes('id="btnPickShortcutReset"'), 'popup.html 缺少「恢复默认」按钮');
    assert.ok(popupHtml.includes('id="pickShortcutCaptureHint"'), 'popup.html 缺少按键捕获提示');
    assert.ok(popupHtml.includes('id="pickShortcutResult"'), 'popup.html 缺少结果提示');
    assert.ok(popupHtml.includes('id="pickShortcutKey"'), '缺少快捷键列表键位锚点');
    assert.ok(popupHtml.includes('id="pickShortcutHintKey"'), '缺少 hint 键位锚点');
    assert.ok(popupHtml.includes('Ctrl+Shift+X'), '默认组合未出现在 popup.html');
    // 按键捕获 + 提交（经 SW chrome.commands.update 改绑）
    assert.ok(popupJs.includes('startShortcutCapture'), 'popup.js 缺少按键捕获入口');
    assert.ok(popupJs.includes('commitShortcut'), 'popup.js 缺少快捷键提交函数');
    assert.ok(popupJs.includes('resetShortcut'), 'popup.js 缺少恢复默认函数');
    assert.match(
      popupJs,
      /action: 'setElementPickerShortcut', shortcut/,
      'popup.js 未发送 setElementPickerShortcut 到 SW',
    );
    assert.ok(
      popupJs.includes('renderPickShortcutDisplay'),
      'popup.js 缺少快捷键显示渲染函数',
    );
    assert.ok(
      popupJs.includes('loadPickShortcutConfig'),
      'popup.js 缺少快捷键配置加载',
    );
    // Esc 取消捕获
    assert.match(popupJs, /e\.key === 'Escape'/, '捕获模式缺少 Esc 取消');
  });

  it('SW 通过 chrome.commands.update 动态改绑快捷键并持久化', () => {
    assert.ok(sw.includes('applyElementPickerShortcut'), 'SW 缺少快捷键应用函数');
    assert.match(sw, /chrome\.commands\.update\(\{ name: 'toggle-element-picker'/, 'SW 未调用 commands.update 改绑');
    assert.ok(sw.includes("case 'setElementPickerShortcut'"), 'SW 缺少 setElementPickerShortcut 消息处理');
    assert.doesNotMatch(sw, /function broadcastElementPickerShortcut/, 'SW 不得跨 tab 广播快捷键');
    assert.match(sw, /Storage\.normalizeShortcut\(shortcut\)/, 'SW 未校验快捷键组合');
    assert.ok(sw.includes('Storage.shortcutToPlatformBinding'), 'SW 未做平台绑定转换（macOS MacCtrl）');
  });

  it('storage.js 提供快捷键组合串模型（默认/迁移/校验/匹配）', () => {
    const storage = read('lib/storage.js');
    assert.ok(storage.includes('SHORTCUT_DEFAULT'), 'storage.js 缺少默认快捷键常量');
    assert.match(storage, /'Ctrl\+Shift\+X'/, '默认快捷键应为 Ctrl+Shift+X');
    assert.ok(storage.includes('normalizeShortcut'), '缺少组合校验函数');
    assert.ok(storage.includes('matchShortcutKeydown'), '缺少 keydown 严格匹配');
    assert.ok(storage.includes('shortcutToPlatformBinding'), '缺少平台绑定转换');
    // 旧版 cmd/ctrl 迁移保留
    assert.match(storage, /if \(v === 'cmd'\) return 'Command\+Shift\+X'/, '缺少旧版 cmd 迁移');
    assert.match(storage, /if \(v === 'ctrl'\) return this\.SHORTCUT_DEFAULT/, '缺少旧版 ctrl 迁移');
  });

  it('文档说明快捷键无效时的排查路径', () => {
    assert.ok(userGuideMd.includes('chrome://extensions/shortcuts'), 'USER_GUIDE.md 缺少排查说明');
    assert.ok(
      userGuideJs.includes('chrome://extensions/shortcuts'),
      'user-guide.js 缺少排查说明',
    );
  });

  it('pick-frame.js 子 frame 内页内兜底按键监听并转发 SW（跨域 iframe 覆盖）', () => {
    // 子 frame 按键不冒泡到顶层 → pick-frame.js 需自备兜底（OPT-20260806-016）
    assert.ok(
      pickFrame.includes('toggleElementPickShortcut'),
      'pick-frame.js 缺少转发 SW 的 action',
    );
    assert.ok(
      pickFrame.includes('chrome.runtime.sendMessage({ action: \'toggleElementPickShortcut\' })'),
      'pick-frame.js 未转发快捷键到 SW',
    );
    // 严格匹配用户自定义的组合串（与 content.js Storage.matchShortcutKeydown 同规则，内联实现）
    assert.ok(pickFrame.includes('matchShortcut'), 'pick-frame 缺少组合匹配函数');
    assert.ok(pickFrame.includes('pickShortcutCombo'), 'pick-frame 缺少组合串变量');
    assert.match(pickFrame, /e\.ctrlKey === mods\.includes\('Ctrl'\)/, 'pick-frame 缺少严格 ctrl 匹配');
    assert.match(pickFrame, /e\.repeat/, 'pick-frame 兜底缺少重复按键忽略');
    // 组合从 storage 加载（含旧版 cmd/ctrl 迁移）+ onChanged 实时同步
    assert.ok(
      pickFrame.includes('elementPickerShortcut'),
      'pick-frame.js 未读取 elementPickerShortcut 配置',
    );
    assert.match(pickFrame, /v === 'cmd' \? 'Command\+Shift\+X'/, 'pick-frame 缺少旧版 cmd 迁移');
    assert.ok(
      pickFrame.includes('storage?.onChanged?.addListener'),
      'pick-frame.js 缺少 storage 变更监听',
    );
    assert.ok(
      pickFrame.includes("document.addEventListener('keydown', onShortcutKeyDown, true)"),
      'pick-frame 兜底 keydown 未以捕获阶段注册',
    );
  });

  it('service-worker 处理子 frame 兜底转发消息（toggleElementPickShortcut）并复用顶层切换', () => {
    assert.ok(
      sw.includes("case 'toggleElementPickShortcut'"),
      'SW 缺少 toggleElementPickShortcut 消息分支',
    );
    assert.ok(
      sw.includes('toggleElementPickInTab'),
      'SW 缺少可复用的 toggleElementPickInTab 函数',
    );
    // 浏览器命令路径与子 frame 转发路径复用同一切换逻辑
    const fnBlock = sw.slice(sw.indexOf('async function toggleElementPickInTab'));
    assert.ok(
      fnBlock.includes('frameId: 0'),
      'toggleElementPickInTab 未优先发送到顶层 frame',
    );
    assert.ok(
      fnBlock.includes('frame0 失败，回退整 tab 广播'),
      'toggleElementPickInTab 缺少整 tab 广播回退',
    );
  });

  // ── OPT-20260806-048: Popup 展示「实际浏览器绑定 vs 配置」差异提示 ──
  it('SW 提供 getElementPickerShortcutStatus（commands.getAll 对比实际绑定）', () => {
    assert.ok(
      sw.includes("case 'getElementPickerShortcutStatus'"),
      'SW 缺少 getElementPickerShortcutStatus 消息分支',
    );
    assert.ok(
      sw.includes('getElementPickerShortcutStatus'),
      'SW 缺少 getElementPickerShortcutStatus 函数',
    );
    assert.ok(
      sw.includes("chrome.commands?.getAll"),
      'SW 未使用 commands.getAll 读取实际绑定',
    );
    assert.ok(
      sw.includes('c.name === \'toggle-element-picker\''),
      'SW 未按命令名查找实际绑定',
    );
    assert.ok(
      sw.includes('differs'),
      'SW 未计算绑定差异标志',
    );
  });

  it('Popup 在绑定差异时渲染提示与恢复入口，并做 HTML 转义', () => {
    assert.ok(
      popupHtml.includes('pickShortcutDiffHint'),
      'popup.html 缺少差异提示元素 pickShortcutDiffHint',
    );
    assert.ok(
      popupJs.includes('checkShortcutBindingDiff'),
      'popup.js 缺少 checkShortcutBindingDiff 函数',
    );
    assert.ok(
      popupJs.includes("action: 'getElementPickerShortcutStatus'"),
      'popup.js 未请求 SW 绑定状态',
    );
    assert.ok(
      popupJs.includes('btnPickShortcutRestore'),
      'popup.js 缺少恢复绑定按钮',
    );
    assert.ok(
      popupJs.includes('escapeHtml'),
      'popup.js 未对绑定串做 HTML 转义（XSS 防护）',
    );
  });

  // ── OPT-20260807-050: 绑定差异警告位于默认收起的折叠区内，检测到差异须自动展开 ──
  it('Popup 绑定差异时自动展开快捷键折叠区（警告不被折叠区隐藏）', () => {
    const differsIdx = popupJs.indexOf('!r.data.differs');
    assert.ok(differsIdx !== -1, 'popup.js 缺少 differs 判定');
    const afterDiffers = popupJs.slice(differsIdx, differsIdx + 1000);
    assert.ok(
      afterDiffers.includes("sec.style.display = 'block'") &&
        afterDiffers.includes("body.style.display = 'block'"),
      '绑定差异后未自动展开 shortcutsSection/shortcutsBody',
    );
    assert.ok(
      afterDiffers.includes("toggleBtn.textContent = '收起'"),
      '绑定差异后未同步 btnToggleShortcuts 为「收起」态',
    );
  });
});
