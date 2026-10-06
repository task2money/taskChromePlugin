'use strict';

/**
 * OPT-20260928-004：工作空间下拉加载失败后就地重试。
 *
 * 此前 getWorkspaces 失败只把错误写进 #popupSaasWorkspaceStatus，用户必须关掉再
 * 打开弹窗才能再拉一次。这里用最小假 DOM 真跑 popup/popup-saas-workspace.js 的
 * IIFE，断言：失败才出现重试按钮、点它会再发一次 getWorkspaces、同一 tick 连点
 * 只发一次（同步点击锁）、成功后按钮收回。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const MODULE = path.join(ROOT, 'popup', 'popup-saas-workspace.js');

/** 仅覆盖本模块用到的那点 DOM：querySelector / createElement / 属性 / 事件。 */
function makeElement(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    childNodes: [],
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
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
    click() {
      for (const fn of this.listeners.click || []) fn({ target: this });
    },
  };
  return el;
}

function setup() {
  const nodes = {
    '#popupSaasWorkspaceRow': makeElement('div'),
    '#popupSaasWorkspace': makeElement('select'),
    '#popupSaasWorkspaceStatus': makeElement('p'),
    '#popupSaasWorkspaceRetry': makeElement('button'),
  };
  nodes['#popupSaasWorkspaceRetry'].hidden = true;

  const sent = [];
  const console_ = { warn() {}, log() {}, error() {} };

  const sandbox = {
    document: {
      readyState: 'complete',
      querySelector: (sel) => nodes[sel] || null,
      createElement: (tag) => makeElement(tag),
      addEventListener() {},
    },
    window: {},
    console: console_,
    tx: (key, params) => (params?.msg ? `${key}:${params.msg}` : key),
    setDataTraceId() {},
    Storage: undefined,
    WorkspaceList: undefined,
    PopupSaasWorkspaceMenu: undefined,
    sendMessageWithTimeout: (msg) => {
      sent.push(msg);
      return sandbox.__respond(msg);
    },
    __respond: () => Promise.resolve({ success: true, data: [] }),
  };
  sandbox.window.PopupSaasWorkspace = undefined;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  // OPT-20261006-014: 控制器改用共用 loginGatedSelect 的重试控制器，先加载。
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'lib', 'popup-login-gated-select.js'), 'utf8'),
    sandbox,
    { filename: 'popup-login-gated-select.js' },
  );
  vm.runInContext(fs.readFileSync(MODULE, 'utf8'), sandbox, { filename: MODULE });
  return { sandbox, nodes, sent };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function workspaceCalls(sent) {
  return sent.filter((m) => m && m.action === 'getWorkspaces');
}

/** 进入 saas 菜单态。 */
function enterSaas(sandbox, loggedIn) {
  sandbox.window.PopupSaasWorkspace.setLoggedIn(loggedIn);
  sandbox.window.PopupSaasWorkspace.syncRoute('saas');
}

describe('Popup 工作空间下拉失败重试（OPT-20260928-004）', () => {
  it('加载成功不显示重试按钮', async () => {
    const { sandbox, nodes, sent } = setup();
    enterSaas(sandbox, true);
    await tick();
    assert.equal(workspaceCalls(sent).length, 1);
    assert.equal(nodes['#popupSaasWorkspaceRetry'].hidden, true);
    assert.equal(nodes['#popupSaasWorkspaceStatus'].textContent, '');
  });

  it('非 saas 路由不拉工作空间；切到 saas 才加载', async () => {
    const { sandbox, nodes, sent } = setup();
    sandbox.window.PopupSaasWorkspace.setLoggedIn(true);
    await tick();
    assert.equal(workspaceCalls(sent).length, 0, 'direct 默认不得 getWorkspaces');
    sandbox.window.PopupSaasWorkspace.syncRoute('direct');
    await tick();
    assert.equal(workspaceCalls(sent).length, 0);
    sandbox.window.PopupSaasWorkspace.syncRoute('saas');
    await tick();
    assert.equal(workspaceCalls(sent).length, 1);
    assert.equal(nodes['#popupSaasWorkspace'].disabled, false);
  });

  it('saas 未登录显示请先登录占位，不发 getWorkspaces', async () => {
    const { sandbox, nodes, sent } = setup();
    enterSaas(sandbox, false);
    await tick();
    assert.equal(workspaceCalls(sent).length, 0);
    assert.equal(nodes['#popupSaasWorkspace'].disabled, true);
    assert.equal(nodes['#popupSaasWorkspace'].childNodes[0].textContent, 'paSaasWorkspaceNeedLogin');
    assert.equal(nodes['#popupSaasWorkspaceRetry'].hidden, true);
  });

  it('失败后出现重试按钮，点它会再发一次 getWorkspaces 并恢复成功态', async () => {
    const { sandbox, nodes, sent } = setup();
    sandbox.__respond = () => Promise.resolve({ success: false, error: 'boom', traceId: 't1' });

    enterSaas(sandbox, true);
    await tick();
    assert.equal(workspaceCalls(sent).length, 1);
    assert.equal(nodes['#popupSaasWorkspaceRetry'].hidden, false, '失败后应给出重试入口');
    assert.match(nodes['#popupSaasWorkspaceStatus'].textContent, /boom/);

    // 网络恢复后再点重试，应当就地重拉而不是要求用户重开弹窗
    sandbox.__respond = () => Promise.resolve({ success: true, data: [] });
    nodes['#popupSaasWorkspaceRetry'].click();
    await tick();
    assert.equal(workspaceCalls(sent).length, 2, '重试必须真的再发一次 getWorkspaces');
    assert.equal(nodes['#popupSaasWorkspaceRetry'].hidden, true, '成功后重试按钮收回');
    assert.equal(nodes['#popupSaasWorkspaceStatus'].textContent, '');
  });

  it('同一 tick 连点重试只发一次（同步点击锁）', async () => {
    const { sandbox, sent } = setup();
    let pending = [];
    sandbox.__respond = () =>
      new Promise((resolve) => {
        pending.push(resolve);
      });
    enterSaas(sandbox, true);
    await tick();

    const retryBtn = sandbox.document.querySelector('#popupSaasWorkspaceRetry');
    // 先让首次加载失败
    for (const resolve of pending) resolve({ success: false, error: 'boom' });
    pending = [];
    await tick();
    assert.equal(retryBtn.hidden, false);

    retryBtn.click();
    retryBtn.click();
    retryBtn.click();
    await tick();
    // 没有同步锁的话三次点击会各自排一个微任务 → 3 次新请求
    assert.equal(workspaceCalls(sent).length, 2, '连点三次只能多出一次请求');

    for (const resolve of pending) resolve({ success: true, data: [] });
    await tick();

    // 上一轮结束后锁必须释放，还能继续重试
    sandbox.__respond = () => Promise.resolve({ success: false, error: 'again' });
    retryBtn.click();
    await tick();
    assert.equal(workspaceCalls(sent).length, 3);
  });

  it('未登录时收起重试按钮，不残留上一次失败态', async () => {
    const { sandbox, nodes } = setup();
    sandbox.__respond = () => Promise.resolve({ success: false, error: 'boom' });
    enterSaas(sandbox, true);
    await tick();
    assert.equal(nodes['#popupSaasWorkspaceRetry'].hidden, false);

    sandbox.window.PopupSaasWorkspace.setLoggedIn(false);
    assert.equal(nodes['#popupSaasWorkspaceRetry'].hidden, true);
    assert.equal(nodes['#popupSaasWorkspaceStatus'].textContent, '');
    assert.equal(nodes['#popupSaasWorkspace'].disabled, true);
  });
});
