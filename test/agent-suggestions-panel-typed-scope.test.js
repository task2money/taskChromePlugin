'use strict';

/**
 * 查询框填了网址时，列表与页签数字都归那条网址（OPT-20261012-024）。
 *
 * 背景：输入框留空时页签数字跟随当前标签页，这是对的。但填了网址并查询后，
 * 列表换成了该网址，页签数字仍会被随后的标签切换（`agentSuggestionsListed`）
 * 改成当前页的数量，用户会把数字当成刚查的那条网址的数量。
 *
 * 本用例在 vm 里加载真实的 `sidepanel/agent-suggestions-panel.js` 与
 * `sidepanel/sidepanel.js`（连同真实的 lib/page-advisor-site-pending.js），
 * 用假 DOM/假 chrome 驱动：填网址查询后收到别的标签的列表消息，断言数字不变；
 * 清空输入框后再收到列表消息，断言数字恢复跟随。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

const MESSAGES = {
  agentSuggestionsTypedScope: '正在查看 {url} 的智能体建议，切换网页标签不改变这里的结果',
  agentSuggestionsEmpty: '当前网页没有待处理的智能体建议',
  agentSuggestionsEmptyUrl: '该网址没有待处理的智能体建议',
  agentSuggestionsInvalidUrl: '请输入 http 或 https 网址，或留空查询当前网页',
  agentSuggestionsLogin: '登录后可查看当前网页的智能体建议',
  agentSuggestionsLoadFail: '智能体建议加载失败',
  agentSuggestionsCountAria: '{n} 条待处理',
  agentSuggestionsPostCount: '{n} 条建议',
};

function makeEl(id) {
  return {
    id,
    textContent: '',
    innerHTML: '',
    hidden: false,
    value: '',
    checked: false,
    disabled: false,
    dataset: {},
    attrs: {},
    listeners: {},
    addEventListener(type, fn) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(fn);
    },
    setAttribute(key, value) { this.attrs[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null; },
    removeAttribute(key) { delete this.attrs[key]; },
    querySelectorAll() { return []; },
    dispatch(type, ev) {
      (this.listeners[type] || []).forEach((fn) => fn(ev || {}));
    },
  };
}

function buildHarness() {
  const els = {};
  const document = {
    getElementById(id) {
      if (!els[id]) els[id] = makeEl(id);
      return els[id];
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };

  const sent = [];
  let listResponse = { success: true, items: [] };
  const context = {
    console,
    document,
    window: { addEventListener() {} },
    URL,
    setTimeout,
    clearTimeout,
    tx(key) { return MESSAGES[key] || key; },
    chrome: {
      runtime: {
        onMessage: { addListener(fn) { context.__onMessage = fn; } },
        getManifest: () => ({ content_scripts: [{ js: [] }] }),
        sendMessage(message) {
          sent.push(message);
          if (message && (message.action === 'listSitePendingForActiveTab'
            || message.action === 'refreshSitePendingForActiveTab')) {
            return Promise.resolve(listResponse);
          }
          return Promise.resolve({ success: true });
        },
      },
      storage: {
        local: { get: async () => ({}), set: async () => {} },
        session: { get: async () => ({}), set: async () => {} },
      },
      tabs: {
        query: async () => [{ id: 7 }],
        onActivated: { addListener() {} },
      },
    },
  };
  context.globalThis = context;
  vm.createContext(context);

  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib', 'page-advisor-site-pending.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sidepanel', 'agent-suggestions-panel.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sidepanel', 'sidepanel.js'), 'utf8'), context);

  return {
    context,
    els,
    sent,
    setListResponse(next) { listResponse = next; },
    elsCount() { return els['sp-agent-count']; },
    setUrl(value) { document.getElementById('sp-agent-url').value = value; },
    status() { return document.getElementById('sp-agent-status').textContent; },
    badgeText() { return (els['sp-agent-count'] || {}).textContent; },
    tabCount() { return (els['sp-tab-agent'] || {}).attrs['data-count'] || null; },
  };
}

const ITEM = { id: '1001', tenant_id: '1', title: '建议一', page_url: 'https://aidevpush.com/x' };

describe('侧边栏智能体建议的网址钉住', () => {
  it('填网址查询后状态行写明在看哪条网址', async () => {
    const h = buildHarness();
    h.setListResponse({ success: true, items: [ITEM] });
    h.setUrl('https://aidevpush.com/x');

    assert.equal(h.context.AgentSuggestionsPanel.isPinnedToTypedUrl(), true);

    await h.context.AgentSuggestionsPanel.refresh();
    const status = h.status();
    assert.match(status, /https:\/\/aidevpush\.com\/x/);
    assert.equal(h.badgeText(), '1', '查询结果数量画在页签上');
  });

  it('钉住时别的标签的列表消息不改数字与列表', async () => {
    const h = buildHarness();
    h.setListResponse({ success: true, items: [ITEM] });
    h.setUrl('https://aidevpush.com/x');
    await h.context.AgentSuggestionsPanel.refresh();
    assert.equal(h.badgeText(), '1');

    // 切到另一个标签：后台推来该标签页的待处理数
    h.context.__onMessage({ action: 'agentSuggestionsListed', tabId: 99, count: 5 });
    assert.equal(h.badgeText(), '1', '钉住时页签数字保持所填网址的数量');
    assert.equal(h.tabCount(), '1');
    assert.match(h.status(), /https:\/\/aidevpush\.com\/x/);
  });

  it('清空输入框后重新跟随当前标签', async () => {
    const h = buildHarness();
    h.setListResponse({ success: true, items: [ITEM] });
    h.setUrl('https://aidevpush.com/x');
    await h.context.AgentSuggestionsPanel.refresh();

    h.setUrl('');
    assert.equal(h.context.AgentSuggestionsPanel.isPinnedToTypedUrl(), false);
    h.context.__onMessage({ action: 'agentSuggestionsListed', tabId: 7, count: 5 });
    assert.equal(h.badgeText(), '5');
    assert.equal(h.tabCount(), '5');
  });

  it('没填网址时列表消息照旧更新数字', async () => {
    const h = buildHarness();
    h.setListResponse({ success: true, items: [ITEM, { ...ITEM, id: '1002' }] });
    await h.context.AgentSuggestionsPanel.refresh();
    assert.equal(h.badgeText(), '2');

    h.context.__onMessage({ action: 'agentSuggestionsListed', tabId: 7, count: 3 });
    assert.equal(h.badgeText(), '3');
  });
});
