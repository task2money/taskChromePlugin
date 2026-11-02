'use strict';

/**
 * popup/popup-shortcut.js 回归测试（规则 41）。
 *
 * 用户要求：Popup 的「快捷键」区默认收起。绑定差异只能点亮折叠标题旁的
 * ⚠️ 徽标，绝不能自动展开 #shortcutsBody 或改写折叠按钮状态。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'popup', 'popup-shortcut.js');

function createBadge() {
  const badge = {
    hidden: true,
    textContent: '',
    attrs: Object.create(null),
    setAttribute(name, value) { this.attrs[name] = String(value); },
    removeAttribute(name) { delete this.attrs[name]; },
  };
  // 与真实 DOM 一致：title 属性与 attrs.title 双向反射。
  Object.defineProperty(badge, 'title', {
    get() { return this.attrs.title || ''; },
    set(value) { this.attrs.title = String(value); },
  });
  return badge;
}

/**
 * 把 popup-shortcut.js 片段放进函数作用域执行，注入最小环境。
 * 片段顶层只声明函数/变量，不产生副作用，因此可安全加载。
 */
function loadFragment(options = {}) {
  const src = fs.readFileSync(SOURCE, 'utf8');
  const badge = createBadge();
  const hint = { style: { display: '' }, textContent: '', innerHTML: '' };
  const selectors = [];
  const responses = options.responses || {};
  const $ = (selector) => {
    selectors.push(selector);
    if (selector === '#shortcutDiffBadge') return badge;
    if (selector === '#pickShortcutDiffHint') return hint;
    return null;
  };
  const tx = (key) => {
    const table = {
      popupShortcutDiffBadge: '⚠️ 绑定有变化',
      popupShortcutDiffBadgeAria: '浏览器快捷键绑定与配置不同',
      popupShortcutMismatchHtml: 'mismatch',
      popupShortcutRestoreLink: 'restore',
    };
    return table[key] || key;
  };
  const sendMessageWithTimeout = async (message) => {
    assert.equal(message.action, 'getElementPickerShortcutStatus');
    return responses.status || { success: true, data: { differs: false } };
  };
  const factory = new Function(
    '$',
    'tx',
    'document',
    'Storage',
    'sendMessageWithTimeout',
    'withTimeout',
    'STORAGE_READ_TIMEOUT',
    'escapeHtml',
    'console',
    `${src}\n;return { setShortcutDiffBadge, checkShortcutBindingDiff };`,
  );
  const api = factory(
    $,
    tx,
    { getElementById: () => null },
    {},
    sendMessageWithTimeout,
    async (value) => value,
    1,
    undefined,
    console,
  );
  return { api, badge, hint, selectors };
}

describe('popup-shortcut 折叠态差异徽标', () => {
  it('setShortcutDiffBadge(true) 显示文案与 aria，false 时完全清空', () => {
    const { api, badge } = loadFragment();

    api.setShortcutDiffBadge(true);
    assert.equal(badge.hidden, false);
    assert.equal(badge.textContent, '⚠️ 绑定有变化');
    assert.equal(badge.attrs.title, '浏览器快捷键绑定与配置不同');
    assert.equal(badge.attrs['aria-label'], '浏览器快捷键绑定与配置不同');

    api.setShortcutDiffBadge(false);
    assert.equal(badge.hidden, true);
    assert.equal(badge.textContent, '');
    assert.equal(badge.title, '');
    assert.equal(badge.attrs['aria-label'], undefined);
  });

  it('绑定差异只点亮徽标与折叠区内提示，不访问折叠区元素', async () => {
    const { api, badge, hint } = loadFragment({
      responses: {
        status: {
          success: true,
          data: { differs: true, configuredBinding: 'Alt+X', actual: '' },
        },
      },
    });

    await api.checkShortcutBindingDiff('Alt+X');

    assert.equal(badge.hidden, false, '差异时折叠标题徽标应可见');
    assert.equal(hint.style.display, 'block', '差异详情仍写入折叠区内部');
    assert.match(hint.innerHTML, /mismatch/);
    assert.ok(hint.innerHTML.includes('btnPickShortcutRestore'), '折叠区内保留恢复入口');
    assert.ok(
      !hint.innerHTML.includes('shortcutsBody'),
      '差异渲染不得注入或操作快捷键折叠容器',
    );
  });

  it('无差异或查询失败时隐藏徽标', async () => {
    const noDiff = loadFragment({
      responses: { status: { success: true, data: { differs: false } } },
    });
    await noDiff.api.checkShortcutBindingDiff('Alt+X');
    assert.equal(noDiff.badge.hidden, true);

    const failed = loadFragment({
      responses: { status: { success: false, error: 'unsupported' } },
    });
    await failed.api.checkShortcutBindingDiff('Alt+X');
    assert.equal(failed.badge.hidden, true);
  });

  it('源码中差异检查不引用快捷键折叠区控件（默认保持收起）', () => {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const start = src.indexOf('async function checkShortcutBindingDiff');
    assert.ok(start !== -1, '缺少 checkShortcutBindingDiff');
    const end = src.indexOf('function escapeHtml', start);
    const block = src.slice(start, end === -1 ? undefined : end);
    assert.doesNotMatch(
      block,
      /\$\('#shortcutsBody'\)|\$\('#shortcutsSection'\)|\$\('#btnToggleShortcuts'\)/,
      '绑定差异不得触碰折叠区/展开按钮',
    );
  });
});
