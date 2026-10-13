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
  agentSuggestionsReloadRetry: '刷新当前网页并重试',
  agentSuggestionsReloading: '正在刷新当前网页…',
  paContextUnreachable: '页面联系不上插件脚本，刷新当前网页即可恢复',
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

function buildHarness({
  generateResponse, skills = SKILLS, promptSkillsApi, storage,
  probeResponse = { success: true, retryable: false },
  reloadResponse = { success: true },
} = {}) {
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
  // 补种路径默认缺席（老本机文档只有 loadFromStorage）；要测补种的用例从
  // promptSkillsApi 传整套 api 进来，自己记调用。
  const promptSkills = Object.assign({
    loadFromStorage: async () => skills,
  }, promptSkillsApi || {});
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
    PageAdvisorPromptSkills: promptSkills,
    chrome: {
      runtime: {
        onMessage: { addListener(fn) { context.__onMessage = fn; } },
        getManifest: () => ({ content_scripts: [{ js: [] }] }),
        sendMessage(message) {
          sent.push(message);
          const action = message && message.action;
          if (action === 'listSitePendingForActiveTab') {
            return Promise.resolve(listResponse);
          }
          if (action === 'generateAgentSuggestionsForActiveTab') {
            return Promise.resolve(generateResponse || { success: true, created: true, projectName: '默认项目' });
          }
          if (action === 'probeAgentSuggestionsChannel') return Promise.resolve(probeResponse);
          if (action === 'reloadPageAndRetryAgentSuggestions') return Promise.resolve(reloadResponse);
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
  if (storage) context.Storage = storage;
  context.globalThis = context;
  vm.createContext(context);

  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sidepanel', 'agent-suggestions-panel.js'), 'utf8'), context);

  return {
    context,
    els,
    sent,
    promptSkills,
    setListResponse(next) { listResponse = next; },
    promptSelect() { return document.getElementById('sp-agent-prompt'); },
    generateBtn() { return document.getElementById('sp-agent-generate'); },
    status() { return document.getElementById('sp-agent-status').textContent; },
    actions() { return sent.map((m) => m && m.action); },
    reloadRetryBtn() { return document.getElementById('sp-agent-reload-retry'); },
    async clickGenerate() {
      const btn = document.getElementById('sp-agent-generate');
      await btn.listeners.click[0]();
    },
    async clickReloadRetry() {
      const btn = document.getElementById('sp-agent-reload-retry');
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

/**
 * 补种系统预埋（ADR-0167 回归修复的另一半）。
 *
 * 宿主页少加载 `lib/page-advisor-prompt-skills.js` 时下拉只剩默认项——那是 e2e 守的。
 * 这里守后半段：模块在、本机文档空着时，侧栏要自己把预埋种下去并且**落盘**。
 * 生成时后台按 skillId 回本机文档取正文（`background/sw-agent-suggestions.js`），
 * 只在下拉里画一条而不落盘的项，用户选中后会静默退回默认提示词。
 *
 * 上面那批用例用的 stub 只有 `loadFromStorage`（老本机文档的形态），补种路径自动
 * 短路，所以它们仍然断言「没有本机技能就只留默认项」；这一组才是补种生效的形态。
 */
describe('侧栏按需补种系统预埋提示词', () => {
  const BUNDLED = {
    id: 'sys_default_auto_innovate',
    title: '系统默认自动创新',
    tendency: 'custom',
    body: '预埋正文',
  };

  /** 造一套带补种的 PageAdvisorPromptSkills，记录调用与落盘。 */
  function seedStub(store, action = 'applied') {
    const calls = { apply: [], saved: [] };
    return {
      calls,
      api: {
        loadFromStorage: async () => store,
        bundledPresetSkills: () => [BUNDLED],
        applySystemCatalogDefault(localStore, catalog, syncTarget) {
          calls.apply.push({ localStore, catalog, syncTarget });
          if (action === 'noop') return { store: localStore, action: 'noop' };
          return {
            store: {
              ...localStore,
              skills: (localStore.skills || []).concat([{ ...BUNDLED, syncTarget, readonly: true }]),
              activeSkillId: localStore.activeSkillId || BUNDLED.id,
            },
            action: 'applied',
          };
        },
        saveToStorage(storeObj, storageApi) {
          calls.saved.push({ storeObj, storageApi });
        },
      },
    };
  }

  it('本机一条提示词都没有时补种预埋，并把预埋写回本机文档', async () => {
    const stub = seedStub({ skills: [], activeSkillId: '', categoryChoices: [] });
    const h = buildHarness({
      promptSkillsApi: stub.api,
      storage: { getLastWorkspace: async () => 'ws-42' },
    });
    await h.context.AgentSuggestionsPanel.refresh();

    // 下拉里真的多了这条，用户才有得选
    assert.match(h.promptSelect().innerHTML, /value="sys_default_auto_innovate"[^>]*>系统默认自动创新</);
    assert.equal(h.promptSelect().value, 'sys_default_auto_innovate');
    // 落盘：后台按 id 回本机文档取正文，不落盘的项选中后会退回默认
    assert.equal(stub.calls.saved.length, 1, '补种结果必须写回 storage');
    assert.deepEqual(
      stub.calls.saved[0].storeObj.skills.map((s) => s.id),
      ['sys_default_auto_innovate'],
    );
    // 预埋落进本机上次用的工作空间，而不是写死 'local'
    assert.equal(stub.calls.apply[0].syncTarget, 'ws-42');
    assert.equal(stub.calls.saved[0].storeObj.skills[0].syncTarget, 'ws-42');
  });

  it('本机已有提示词时不抢：既不补种也不落盘', async () => {
    const stub = seedStub({
      skills: [{ id: 'sku-seo', title: 'SEO 标题优化', tendency: 'seo' }],
      activeSkillId: 'sku-seo',
      categoryChoices: [],
    });
    const h = buildHarness({ promptSkillsApi: stub.api });
    await h.context.AgentSuggestionsPanel.refresh();

    assert.equal(stub.calls.apply.length, 0, '本机有货时不该碰目录');
    assert.equal(stub.calls.saved.length, 0, '更不该覆盖本机文档');
    assert.match(h.promptSelect().innerHTML, /value="sku-seo"[^>]*>SEO 标题优化</);
  });

  it('补种判定 noop 时不落盘，下拉保持原样', async () => {
    const stub = seedStub({ skills: [], activeSkillId: '', categoryChoices: [] }, 'noop');
    const h = buildHarness({ promptSkillsApi: stub.api });
    await h.context.AgentSuggestionsPanel.refresh();

    assert.equal(stub.calls.apply.length, 1, '判定过，只是没得改');
    assert.equal(stub.calls.saved.length, 0, 'noop 不该写盘');
    assert.equal(h.promptSelect().value, '');
  });
});

describe('侧边栏「刷新当前网页并重试」（OPT-20261013-019）', () => {
  const UNREACHABLE = {
    success: false,
    error: '页面联系不上插件脚本，刷新当前网页即可恢复',
    errorCode: 'PAGE_CONTEXT_UNREACHABLE',
  };

  it('生成因「联系不上插件脚本」失败：露出刷新入口，页面类型不支持则不露', async () => {
    const unreachable = buildHarness({ generateResponse: UNREACHABLE });
    await unreachable.context.AgentSuggestionsPanel.refresh();
    await unreachable.clickGenerate();
    assert.equal(unreachable.reloadRetryBtn().hidden, false);

    const restricted = buildHarness({
      generateResponse: { success: false, error: '该页面类型不支持', errorCode: 'PAGE_CONTEXT_RESTRICTED_PAGE' },
    });
    await restricted.context.AgentSuggestionsPanel.refresh();
    await restricted.clickGenerate();
    assert.equal(restricted.reloadRetryBtn().hidden, true, '刷新救不了的页面别给死路');
  });

  it('打开面板时探到通道不通：不用先点一次生成就把刷新入口摆出来', async () => {
    const h = buildHarness({ probeResponse: { success: true, state: 'unreachable', retryable: true } });
    await h.context.AgentSuggestionsPanel.refresh();
    // 探测是「不挡列表」的后台动作，等它落地
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.reloadRetryBtn().hidden, false);
    assert.ok(h.actions().includes('probeAgentSuggestionsChannel'));
  });

  it('点「刷新并重试」：后台刷新成功后自动重跑一次生成', async () => {
    const h = buildHarness({ generateResponse: { success: true, created: true, projectName: '默认项目' } });
    await h.context.AgentSuggestionsPanel.refresh();
    await h.clickReloadRetry();

    assert.equal(h.actions().filter((a) => a === 'reloadPageAndRetryAgentSuggestions').length, 1);
    assert.equal(h.actions().filter((a) => a === 'generateAgentSuggestionsForActiveTab').length, 1);
    assert.equal(h.reloadRetryBtn().hidden, true, '恢复后收起入口');
    assert.equal(h.status(), '已在「默认项目」创建优化贴');
  });

  it('刷新后通道仍不通：不重跑生成，如实报失败', async () => {
    const h = buildHarness({
      reloadResponse: { success: false, error: '页面联系不上插件脚本，刷新当前网页即可恢复', errorCode: 'PAGE_CONTEXT_UNREACHABLE' },
    });
    await h.context.AgentSuggestionsPanel.refresh();
    await h.clickReloadRetry();

    assert.equal(h.actions().filter((a) => a === 'generateAgentSuggestionsForActiveTab').length, 0);
    assert.match(h.status(), /刷新当前网页即可恢复/);
  });
});
