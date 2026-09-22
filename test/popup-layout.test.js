'use strict';

/**
 * Popup 面板布局：收窄宽度 + 快捷键说明「点击后再展开」
 *
 * 覆盖（静态验证，防止后续改动破坏）：
 *  - 面板宽度收窄（340px → 300px，快捷键说明区不需要那么宽）
 *  - 快捷键说明默认收起（#shortcutsBody 初始 display:none），点击「展开」后显示
 *  - popup.js 绑定 展开/收起 切换逻辑（与请求预览区同一交互模式）
 *  - 自定义行键位锚点独立 id（改键后列表与自定义行同步刷新，无重复 id）
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { readPopupBundle } = require('./helpers/popupBundle.js');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const popupHtml = read('popup/popup.html');
const popupJs = readPopupBundle();
const popupCss = read('popup/popup.css');

describe('Popup 悬浮球显示隐藏开关常显', () => {
  it('有独立 #floatBallSection，开关不在请求预览区内', () => {
    assert.match(popupHtml, /id="floatBallSection"/);
    assert.match(popupHtml, /id="floatBallToggle"/);
    assert.match(popupHtml, /显示悬浮球/);
    const reqStart = popupHtml.indexOf('id="requestsSection"');
    assert.ok(reqStart >= 0, '缺少 requestsSection');
    const reqEnd = popupHtml.indexOf('</section>', reqStart);
    const reqBlock = popupHtml.slice(reqStart, reqEnd);
    assert.doesNotMatch(reqBlock, /floatBallToggle/, '开关不得放在请求预览区内');
  });

  it('登录态与未登录态都会显示悬浮球开关区', () => {
    assert.match(popupJs, /function setFloatBallSectionVisible/);
    const loginFn = popupJs.slice(
      popupJs.indexOf('function showLoginUI'),
      popupJs.indexOf('function showTokenExpiredUI')
    );
    const loggedInFn = popupJs.slice(
      popupJs.indexOf('function showLoggedInUI'),
      popupJs.indexOf('async function loadStateFromStorage')
    );
    assert.match(loginFn, /setFloatBallSectionVisible\(\s*true\s*\)/, '未登录须显示开关');
    assert.match(loggedInFn, /setFloatBallSectionVisible\(\s*true\s*\)/, '已登录须显示开关');
  });

  it('未登录也会从 storage 同步开关状态', () => {
    const loginFn = popupJs.slice(
      popupJs.indexOf('function showLoginUI'),
      popupJs.indexOf('function showTokenExpiredUI')
    );
    assert.match(loginFn, /loadFloatBallConfig\(\)/, '未登录须同步 floatBallEnabled');
  });
});

// OPT-20260821-008: 悬浮球开关只写 storage，不向全部标签页 sendMessage。
describe('Popup 悬浮球开关不再跨 tab 扇出', () => {
  it('开关段无 chrome.tabs.query({}) 与 setFloatBallEnabled 广播', () => {
    const start = popupJs.indexOf('悬浮球开关');
    const end = popupJs.indexOf('跟踪开关');
    const seg = popupJs.slice(start, end === -1 ? popupJs.length : end);
    assert.doesNotMatch(seg, /chrome\.tabs\.query\(\{\}\)/, '悬浮球开关不得查询全部标签页');
    assert.doesNotMatch(seg, /setFloatBallEnabled/, '悬浮球开关不得向标签页广播 setFloatBallEnabled');
  });
});

describe('Popup 未登录：登录入口置顶并可折叠', () => {
  it('T1 #loginSection 紧随 header，且在悬浮球区之前', () => {
    const headerEnd = popupHtml.indexOf('</header>');
    const loginIdx = popupHtml.indexOf('id="loginSection"');
    const floatIdx = popupHtml.indexOf('id="floatBallSection"');
    assert.ok(headerEnd > 0 && loginIdx > 0 && floatIdx > 0, '缺少 header / login / float 锚点');
    assert.ok(loginIdx > headerEnd, '登录区必须在 </header> 之后');
    assert.ok(loginIdx < floatIdx, '登录区必须在 #floatBallSection 之前（最上方功能区）');
  });

  it('T2 顶栏 ⚠️ 未登录旁有 #btnToggleLogin；登录区默认折叠', () => {
    const header = popupHtml.match(/<header[\s\S]*?<\/header>/)[0];
    assert.match(header, /id="popupStatus"/);
    assert.match(header, /id="btnToggleLogin"/);
    const statusIdx = header.indexOf('id="popupStatus"');
    const btnIdx = header.indexOf('id="btnToggleLogin"');
    assert.ok(btnIdx > statusIdx, '登录按钮须紧挨未登录徽标之后');
    const m = popupHtml.match(/<section id="loginSection"[^>]*>/);
    assert.ok(m && m[0].includes('display:none'), '未展开时登录表单不得占位');
  });

  it('T3 popup 绑定点击展开/收起，错误与过期自动展开', () => {
    assert.match(popupJs, /btnToggleLogin/, '未绑定顶栏登录按钮');
    assert.match(popupJs, /aria-expanded/, '折叠态须暴露 aria-expanded');
    const loginFn = popupJs.slice(
      popupJs.indexOf('function showLoginUI'),
      popupJs.indexOf('function showTokenExpiredUI'),
    );
    assert.match(loginFn, /errorMessage/, 'showLoginUI 须区分错误自动展开');
    const expiredFn = popupJs.slice(
      popupJs.indexOf('function showTokenExpiredUI'),
      popupJs.indexOf('function showLoggedInUI'),
    );
    assert.match(expiredFn, /setLoginFormExpanded\(\s*true\s*\)|loginSec\.style\.display = 'block'/,
      '会话过期须展开登录表单');
  });
});

describe('Popup 面板布局', () => {
  it('面板收窄：body 宽度为 300px（不需要那么宽）', () => {
    assert.match(popupCss, /width:\s*300px/, 'popup.css body 宽度应收窄为 300px');
  });

  it('快捷键说明默认收起：#shortcutsBody 初始 display:none，内容保留', () => {
    assert.ok(popupHtml.includes('id="btnToggleShortcuts"'), '缺少「展开/收起」按钮');
    const m = popupHtml.match(/<div id="shortcutsBody"[^>]*>/);
    assert.ok(m && m[0].includes('display:none'), 'shortcutsBody 初始应折叠（点击后再展开）');
    // 折叠后内容仍完整保留在文档中
    assert.ok(popupHtml.includes('切换指针选择模式'), '快捷键列表内容缺失');
    assert.ok(popupHtml.includes('id="btnPickShortcutEdit"'), '自定义按钮应保留在折叠区内');
    assert.ok(popupHtml.includes('taskplugin-shortcut-settings'), '排查链接应保留在折叠区内');
  });

  it('popup.js 绑定「点击后展开/收起」切换逻辑', () => {
    assert.ok(popupJs.includes('btnToggleShortcuts'), 'popup.js 未读取切换按钮');
    assert.ok(popupJs.includes('shortcutsBody'), 'popup.js 未切换 shortcutsBody');
    assert.match(popupJs, /body\.style\.display === 'none'/, '缺少折叠判断');
    assert.match(
      popupJs,
      /textContent = tx\('(?:expand|commonCollapse)'\)/,
      '按钮文案缺少 i18n 展开/收起态（expand / commonCollapse）',
    );
  });

  it('快捷键键位锚点无重复 id：列表/自定义行/hint 各自独立，改键后全部跟随刷新', () => {
    const ids = ['pickShortcutKey', 'pickShortcutCustomKey', 'pickShortcutHintKey'];
    for (const id of ids) {
      const count = popupHtml.split(`id="${id}"`).length - 1;
      assert.equal(count, 1, `id="${id}" 应唯一（当前出现 ${count} 次）`);
    }
    assert.ok(
      popupJs.includes("['pickShortcutKey', 'pickShortcutCustomKey', 'pickShortcutHintKey']"),
      'renderPickShortcutDisplay 未同步刷新自定义行键位',
    );
  });
});
