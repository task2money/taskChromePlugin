'use strict';

/**
 * 侧边栏「智能体建议」：网址输入框与查询按钮已去掉（ADR-0167）。
 *
 * 列表固定跟随当前网页，用户能做的两件事变成：
 * 1. 在提示词下拉菜单里选一条提示词（来自本机 prompt skills，多选一，可留默认）；
 * 2. 点「给当前网页生成建议」，生成完把优化贴落到域名的项目（或默认项目）。
 *
 * 本用例在 vm 里加载真实的 `sidepanel/agent-suggestions-panel.js`，用假 DOM / 假 chrome
 * 驱动：断言下拉菜单按本机技能填充并预选激活项、点生成发的是生成消息、
 * 生成期间按钮锁住、生成后状态行报出落点项目。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

const MESSAGES = {
  agentSuggestionsEmpty: '当前网页没有待处理的智能体建议',
  agentSuggestionsLogin: '登录后可查看当前网页的智能体建议',
  agentSuggestionsLoadFail: '智能体建议加载失败',
  agentSuggestionsCountAria: '{n} 条待处理',
  agentSuggestionsPostCount: '{n} 条建议',
  agentSuggestionsPromptLabel: '提示词',
  agentSuggestionsPromptDefault: '默认提示词',
  agentSuggestionsGenerate: '给当前网页生成建议',
  agentSuggestionsGenerating: '正在为当前网页生成建议…',
  agentSuggestionsGeneratedInto: '已在「{project}」创建优化贴',
  agentSuggestionsPostedExisting: '「{project}」里已有当前网页的优化贴',
  agentSuggestionsGenerateFail: '生成建议失败',
};

const SKILLS = {
  skills: [
    { id: 'sku-seo', title: 'SEO 标题优化', tendency: 'seo', body: '...' },
    { id: 'sku-cvr', title: '转化率提升', tendency: 'conversion', body: '...' },
  ],
  activeSkillId: 'sku-cvr',
  categoryChoices: [],
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

function buildHarness({ generateResponse, skills = SKILLS } = {}) {
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
    tx: (key, params) => {
      let out = MESSAGES[key] || key;
      if (params && typeof params === 'object') {
        Object.keys(params).forEach((k) => { out = out.replace(`{${k}}`, String(params[k])); });
      }
      return out;
    },
    PageAdvisorPromptSkills: {
      loadFromStorage: async () => skills,
    },
    chrome: {
      runtime: {
        onMessage: { addListener(fn) { context.__onMessage = fn; } },
        getManifest: () => ({ content_scripts: [{ js: [] }] }),
        sendMessage(message) {
          sent.push(message);
          if (message && message.action === 'listSitePendingForActiveTab') {
            return Promise.resolve(listResponse);
          }
          if (message && message.action === 'generateAgentSuggestionsForActiveTab') {
            return Promise.resolve(generateResponse || { success: true, created: true, projectName: '默认项目' });
          }
          return Promise.resolve({ success: true });
        },
      },
      storage: {
        local: { get: async () => ({}), set: async () => {} },
        session: { get: async () => ({}), set: async () => {} },
      },
      tabs: { query: async () => [{ id: 7 }], onActivated: { addListener() {} } },
    },
  };
  context.globalThis = context;
  vm.createContext(context);

  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sidepanel', 'agent-suggestions-panel.js'), 'utf8'), context);

  return {
    context,
    els,
    sent,
    setListResponse(next) { listResponse = next; },
    promptSelect() { return document.getElementById('sp-agent-prompt'); },
    generateBtn() { return document.getElementById('sp-agent-generate'); },
    status() { return document.getElementById('sp-agent-status').textContent; },
    actions() { return sent.map((m) => m && m.action); },
    async clickGenerate() {
      const btn = document.getElementById('sp-agent-generate');
      await btn.listeners.click[0]();
    },
  };
}

describe('侧边栏智能体建议的提示词下拉与生成按钮', () => {
  it('下拉菜单按本机技能填充，并预选激活的那条', async () => {
    const h = buildHarness();
    await h.context.AgentSuggestionsPanel.refresh();

    const html = h.promptSelect().innerHTML;
    assert.match(html, /value=""/, '首项是默认提示词，允许不指定');
    assert.match(html, /value="sku-seo"[^>]*>SEO 标题优化</);
    assert.match(html, /value="sku-cvr"[^>]*>转化率提升</);
    assert.equal(h.promptSelect().value, 'sku-cvr');
  });

  it('没有本机技能时下拉只留默认项，不报错', async () => {
    const h = buildHarness({ skills: { skills: [], activeSkillId: '' } });
    await h.context.AgentSuggestionsPanel.refresh();
    assert.equal(h.promptSelect().value, '');
    assert.doesNotMatch(h.promptSelect().innerHTML, /<option value="(?!")/);
  });

  it('点生成按钮发的是当前网页的生成消息，带上选中的提示词', async () => {
    const h = buildHarness();
    await h.context.AgentSuggestionsPanel.refresh();
    h.promptSelect().value = 'sku-seo';

    await h.clickGenerate();

    const gen = h.sent.find((m) => m && m.action === 'generateAgentSuggestionsForActiveTab');
    assert.ok(gen, 'generation message sent');
    assert.equal(gen.skillId, 'sku-seo');
    assert.equal(gen.promptTendency, 'seo');
    assert.equal(gen.pageUrl, undefined, '生成只管当前网页，不再传网址');
  });

  it('生成中按钮锁住并写明状态，生成完报出落点项目', async () => {
    const h = buildHarness({
      generateResponse: { success: true, created: true, projectName: '默认项目', postId: '1001' },
    });
    await h.context.AgentSuggestionsPanel.refresh();
    h.setListResponse({ success: true, items: [{ id: '1001', tenant_id: '1', title: '建议一' }] });

    const btn = h.generateBtn();
    const pending = h.clickGenerate();
    assert.equal(btn.disabled, true, '生成期间按钮不可重复点');
    assert.equal(btn.getAttribute('aria-busy'), 'true');
    assert.match(h.status(), /正在为当前网页生成建议/);
    await pending;

    assert.equal(btn.disabled, false);
    assert.equal(h.status(), '已在「默认项目」创建优化贴');
    assert.ok(h.actions().includes('listSitePendingForActiveTab'), '生成后重拉列表');
  });

  it('已存在的优化贴不谎报新建', async () => {
    const h = buildHarness({
      generateResponse: { success: true, created: false, projectName: '官网', postId: '1001' },
    });
    await h.context.AgentSuggestionsPanel.refresh();
    await h.clickGenerate();
    assert.equal(h.status(), '「官网」里已有当前网页的优化贴');
  });

  it('生成失败把后台的错因写到状态行，按钮恢复可点', async () => {
    const h = buildHarness({
      generateResponse: { success: false, error: '未登录', traceId: 't-1' },
    });
    await h.context.AgentSuggestionsPanel.refresh();
    await h.clickGenerate();

    assert.equal(h.status(), '未登录');
    assert.equal(h.generateBtn().disabled, false);
  });
});
