'use strict';

/**
 * Task 14：popup 网页优化设置区收敛为「工作空间」。
 *
 * - 旧「调用方式 / 直连 Key / 浏览器内置模型 / 提示词 Skill」设置区整块删除；
 * - 登录后只显示工作空间下拉（复用 PopupSaasWorkspace 的默认选择 / 手选持久化）；
 * - 未登录整个设置区不出现，也不再显示「请先登录」占位行；
 * - 工作空间文案随 popup 文案包（i18n-popup-messages.js）加载，不再依赖旧 LLM 路由文案包。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const MODULE = path.join(ROOT, 'popup', 'popup-saas-workspace.js');
const LIB = require('../lib/popup-saas-workspace.js');

const ROWS = [
  { id: 'ws-a', name: 'A' },
  { id: 'ws-b', name: 'B', is_default: true },
];

function popupHtml() {
  return fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
}

describe('popup.html：设置区只剩工作空间', () => {
  it('旧调用方式 / 提示词 Skill 设置区已整块移除', () => {
    const html = popupHtml();
    assert.doesNotMatch(html, /id="pageAdvisorLlmSection"/);
    assert.doesNotMatch(html, /id="pageAdvisorSkillSection"/);
    assert.doesNotMatch(html, /id="popupLlmRouteField"/);
    assert.doesNotMatch(html, /id="popupSkillList"/);
    assert.doesNotMatch(html, /id="popupSaasWorkspace"/);
  });

  it('工作空间设置区结构齐全且默认隐藏', () => {
    const html = popupHtml();
    assert.match(html, /id="pageAdvisorWorkspaceSection"[^>]*style="display:none"/);
    assert.match(html, /data-i18n="paWorkspaceSectionTitle"/);
    assert.match(html, /data-i18n="paWorkspaceSectionHint"/);
    assert.match(html, /data-i18n="paAltZHintShort"/);
    assert.match(html, /id="popupPageAdvisorWorkspace"[^>]*data-testid="popup-page-advisor-workspace"/);
    assert.match(html, /id="popupPageAdvisorWorkspaceStatus"[^>]*aria-live="polite"/);
    assert.match(html, /id="popupPageAdvisorWorkspaceRetry"[^>]*\bhidden\b/);
    assert.match(html, /id="popupPageAdvisorWorkspaceRetry"[^>]*data-i18n="paSaasWorkspaceRetry"/);
    assert.match(html, /data-i18n="paSaasWorkspaceLabel"/);
  });

  it('工作空间模块各加载一次，且 popup.html 注入的脚本都存在', () => {
    const html = popupHtml();
    for (const m of html.matchAll(/<script src="([^"]+)"/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, 'popup', m[1])), `popup.html 注入的 ${m[1]} 不存在`);
    }
    assert.equal((html.match(/src="\.\.\/lib\/popup-saas-workspace\.js"/g) || []).length, 1);
    assert.equal((html.match(/src="popup-saas-workspace\.js"/g) || []).length, 1);
  });
});

describe('工作空间显隐纯函数', () => {
  it('只按登录态决定：未登录 hidden，登录后 menu', () => {
    assert.equal(typeof LIB.pageAdvisorWorkspaceUiMode, 'function');
    assert.equal(LIB.pageAdvisorWorkspaceUiMode(false), 'hidden');
    assert.equal(LIB.pageAdvisorWorkspaceUiMode(true), 'menu');
    assert.equal(LIB.saasWorkspaceVisible(false), false);
    assert.equal(LIB.saasWorkspaceVisible(true), true);
  });
});

describe('i18n：工作空间文案随 popup 文案包加载', () => {
  it('新键与搬迁过来的键在 zh/en 双表齐备', () => {
    const { zh, en } = require('../lib/i18n-popup-messages.js');
    const keys = [
      'paWorkspaceSectionTitle',
      'paWorkspaceSectionHint',
      'paAltZHintShort',
      'paSaasWorkspaceLabel',
      'paSaasWorkspaceRetry',
      'paSaasWorkspaceNeedLogin',
      'paLlmSaasSettingsLink',
    ];
    for (const key of keys) {
      assert.equal(typeof zh[key], 'string', `zh 缺 ${key}`);
      assert.ok(zh[key], `zh ${key} 为空`);
      assert.equal(typeof en[key], 'string', `en 缺 ${key}`);
      assert.ok(en[key], `en ${key} 为空`);
    }
  });
});

/** 仅覆盖 popup-saas-workspace.js 用到的那点 DOM。 */
function makeElement(tag = 'div', style = {}) {
  return {
    tagName: String(tag).toUpperCase(),
    childNodes: [],
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    style: { ...style },
    dataset: {},
    listeners: {},
    replaceChildren(...nodes) {
      this.childNodes = nodes;
      return undefined;
    },
    appendChild(node) {
      this.childNodes.push(node);
      return node;
    },
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    fire(type) {
      for (const fn of this.listeners[type] || []) fn({ target: this });
    },
  };
}

function setup({ lastId = '', manual = null, rows = ROWS } = {}) {
  const nodes = {
    '#pageAdvisorWorkspaceSection': makeElement('section', { display: 'none' }),
    '#popupPageAdvisorWorkspace': makeElement('select'),
    '#popupPageAdvisorWorkspaceStatus': makeElement('p'),
    '#popupPageAdvisorWorkspaceRetry': makeElement('button'),
  };
  nodes['#pageAdvisorWorkspaceSection'].style.display = 'none';
  nodes['#popupPageAdvisorWorkspaceRetry'].hidden = true;

  const writes = [];
  const sent = [];
  const sandbox = {
    document: {
      readyState: 'complete',
      querySelector: (sel) => nodes[sel] || null,
      createElement: (tag) => makeElement(tag),
      addEventListener() {},
    },
    console: { warn() {}, log() {}, error() {} },
    tx: (key, params) => (params?.msg ? `${key}:${params.msg}` : key),
    setDataTraceId() {},
    Storage: {
      getLastWorkspace: async () => lastId,
      getLastWorkspaceManual: async () => manual,
      saveLastWorkspace: async (id, opts) => {
        writes.push({ id, manual: opts?.manual });
      },
    },
    WorkspaceList: undefined,
    PopupSaasWorkspaceMenu: undefined,
    sendMessageWithTimeout: (msg) => {
      sent.push(msg);
      return sandbox.__respond(msg);
    },
    __respond: () => Promise.resolve({ success: true, data: rows }),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'lib', 'popup-login-gated-select.js'), 'utf8'),
    sandbox,
    { filename: 'popup-login-gated-select.js' },
  );
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'lib', 'popup-saas-workspace.js'), 'utf8'),
    sandbox,
    { filename: 'popup-saas-workspace.js' },
  );
  vm.runInContext(fs.readFileSync(MODULE, 'utf8'), sandbox, { filename: MODULE });
  return { sandbox, nodes, writes, sent };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function workspaceCalls(sent) {
  return sent.filter((m) => m && m.action === 'getWorkspaces');
}

describe('工作空间设置区显隐与渲染', () => {
  it('未登录整块隐藏且不拉取；登录后显示并渲染选项', async () => {
    const { sandbox, nodes, sent } = setup();
    assert.equal(typeof sandbox.window.PopupSaasWorkspace.syncLoggedIn, 'function');
    assert.equal(typeof sandbox.window.PopupSaasWorkspace.setLoggedIn, 'function');

    sandbox.window.PopupSaasWorkspace.syncLoggedIn(false);
    await tick();
    assert.equal(nodes['#pageAdvisorWorkspaceSection'].hidden, true);
    assert.equal(nodes['#pageAdvisorWorkspaceSection'].style.display, 'none');
    assert.equal(workspaceCalls(sent).length, 0);

    sandbox.window.PopupSaasWorkspace.syncLoggedIn(true);
    await tick();
    await tick();
    assert.equal(nodes['#pageAdvisorWorkspaceSection'].hidden, false);
    assert.equal(nodes['#pageAdvisorWorkspaceSection'].style.display, '');
    assert.equal(workspaceCalls(sent).length, 1);
    assert.deepEqual(
      nodes['#popupPageAdvisorWorkspace'].childNodes.map((o) => o.value),
      ['ws-a', 'ws-b'],
    );
    assert.equal(nodes['#popupPageAdvisorWorkspace'].value, 'ws-b');
  });

  it('渲染工作空间并持久化手选', async () => {
    const { sandbox, nodes, writes } = setup({ lastId: 'ws-b', manual: true });
    sandbox.window.PopupSaasWorkspace.syncLoggedIn(true);
    await tick();
    await tick();

    assert.equal(nodes['#popupPageAdvisorWorkspace'].value, 'ws-b');
    assert.deepEqual(writes, []);

    nodes['#popupPageAdvisorWorkspace'].value = 'ws-a';
    nodes['#popupPageAdvisorWorkspace'].fire('change');
    await tick();
    assert.deepEqual(writes, [{ id: 'ws-a', manual: true }]);
  });

  it('未登录会丢弃仍在途的加载结果', async () => {
    const { sandbox, nodes, sent } = setup();
    let resolveLoad;
    sandbox.__respond = () => new Promise((resolve) => { resolveLoad = resolve; });
    sandbox.window.PopupSaasWorkspace.syncLoggedIn(true);
    await tick();
    assert.equal(workspaceCalls(sent).length, 1);

    sandbox.window.PopupSaasWorkspace.syncLoggedIn(false);
    resolveLoad({ success: true, data: ROWS });
    await tick();
    await tick();
    assert.equal(nodes['#pageAdvisorWorkspaceSection'].hidden, true);
    assert.equal(nodes['#popupPageAdvisorWorkspace'].value, '');
  });
});
