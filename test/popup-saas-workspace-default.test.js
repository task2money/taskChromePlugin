'use strict';

/**
 * 登录后「调用平台后端」自动选中平台默认工作空间（is_default=1），
 * 除非用户手动切换过工作空间（lastWorkspaceManual=true；旧值无标志仍视为手选）。
 *
 * 此前：没存过选择且工作空间多于一个时下拉停在「请选择工作空间」，
 * Alt+Z 会提示「请先在扩展弹窗选择 Alt+Z 默认工作空间」，用户必须先手选一次。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const MODULE = path.join(ROOT, 'popup', 'popup-saas-workspace.js');
const {
  buildSaasWorkspaceMenu,
  pickPlatformDefaultWorkspaceId,
} = require('../lib/popup-saas-workspace.js');

const LABELS = ['空间A', '空间B', '空间C'];
const THREE = [
  { id: 'ws-a', name: 'A' },
  { id: 'ws-b', name: 'B', is_default: true },
  { id: 'ws-c', name: 'C' },
];

describe('平台默认工作空间：自动选中（纯函数）', () => {
  it('无手选时自动选中 is_default 并要求落盘', () => {
    const menu = buildSaasWorkspaceMenu(THREE, '', LABELS, { manual: false });
    assert.deepEqual(menu.options.map((o) => o.id), ['ws-a', 'ws-b', 'ws-c']);
    assert.equal(menu.selectedId, 'ws-b');
    assert.equal(menu.persist, true);
    assert.equal(menu.source, 'default');
  });

  it('用户手选的工作空间优先于平台默认', () => {
    const menu = buildSaasWorkspaceMenu(THREE, 'ws-c', LABELS, { manual: true });
    assert.equal(menu.selectedId, 'ws-c');
    assert.equal(menu.persist, false);
    assert.equal(menu.source, 'manual');
  });

  it('旧值无 manual 标志（浮窗/批量创建/旧版本写入）视为手选，保持既有行为', () => {
    const menu = buildSaasWorkspaceMenu(THREE, 'ws-c', LABELS);
    assert.equal(menu.selectedId, 'ws-c');
    assert.equal(menu.persist, false);
    assert.equal(menu.source, 'manual');
  });

  it('此前自动选中的默认改默认后跟随新默认', () => {
    const rows = [
      { id: 'ws-a', name: 'A' },
      { id: 'ws-b', name: 'B' },
      { id: 'ws-c', name: 'C', is_default: true },
    ];
    const menu = buildSaasWorkspaceMenu(rows, 'ws-b', LABELS, { manual: false });
    assert.equal(menu.selectedId, 'ws-c', 'auto 选中的旧默认不得粘住');
    assert.equal(menu.persist, true);
    assert.equal(menu.source, 'default');
  });

  it('手选的工作空间已不在列表时回落到默认并清手选标志', () => {
    const menu = buildSaasWorkspaceMenu(THREE, 'ws-gone', LABELS, { manual: true });
    assert.equal(menu.selectedId, 'ws-b');
    assert.equal(menu.persist, true);
    assert.equal(menu.source, 'default');
  });

  it('多租户各有默认时优先 is_current 的那一个', () => {
    const rows = [
      { id: 'ws-x', name: 'X', is_default: true, company_id: 'c1' },
      { id: 'ws-y', name: 'Y', is_default: true, is_current: true, company_id: 'c2' },
    ];
    assert.equal(pickPlatformDefaultWorkspaceId(rows), 'ws-y');
    const menu = buildSaasWorkspaceMenu(rows, '', ['X', 'Y'], { manual: false });
    assert.equal(menu.selectedId, 'ws-y');
  });

  it('is_default 为 1 / "true" 时同样识别（后端布尔以外的写法容错）', () => {
    assert.equal(pickPlatformDefaultWorkspaceId([{ id: 'ws-a' }, { id: 'ws-b', is_default: 1 }]), 'ws-b');
    assert.equal(pickPlatformDefaultWorkspaceId([{ id: 'ws-a', is_default: 'true' }]), 'ws-a');
    assert.equal(pickPlatformDefaultWorkspaceId([{ id: 'ws-a', is_default: '0' }, { id: 'ws-b' }]), '');
  });

  it('无默认工作空间时仍按旧规则：唯一空间自动选中，多空间留占位', () => {
    const many = buildSaasWorkspaceMenu([{ id: 'x' }, { id: 'y' }], '', ['X', 'Y'], { manual: false });
    assert.equal(many.selectedId, '');
    assert.equal(many.persist, false);
    assert.equal(many.source, '');

    const only = buildSaasWorkspaceMenu([{ id: 'x' }], '', ['X'], { manual: false });
    assert.equal(only.selectedId, 'x');
    assert.equal(only.persist, true);
    assert.equal(only.source, 'single');
  });

  it('自动选中同一个默认时不重复落盘', () => {
    const menu = buildSaasWorkspaceMenu(THREE, 'ws-b', LABELS, { manual: false });
    assert.equal(menu.selectedId, 'ws-b');
    assert.equal(menu.persist, false);
  });
});

/** 仅覆盖 popup-saas-workspace.js 用到的那点 DOM。 */
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
    fire(type) {
      for (const fn of this.listeners[type] || []) fn({ target: this });
    },
  };
  return el;
}

function setup({ lastId = '', manual = null, rows = [], writeFail = null } = {}) {
  const nodes = {
    '#popupSaasWorkspaceRow': makeElement('div'),
    '#popupSaasWorkspace': makeElement('select'),
    '#popupSaasWorkspaceStatus': makeElement('p'),
    '#popupSaasWorkspaceRetry': makeElement('button'),
  };
  nodes['#popupSaasWorkspaceRetry'].hidden = true;

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
        if (writeFail) throw writeFail;
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
  sandbox.window.PopupSystemSku = undefined;

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

async function enterSaas(sandbox) {
  sandbox.window.PopupSaasWorkspace.setLoggedIn(true);
  sandbox.window.PopupSaasWorkspace.syncRoute('saas');
  await tick();
  await tick();
}

describe('平台默认工作空间：弹窗下拉（真 DOM 片段）', () => {
  it('登录后自动选中默认工作空间并以 auto 落盘', async () => {
    const { sandbox, nodes, writes } = setup({ rows: THREE });
    await enterSaas(sandbox);
    assert.equal(nodes['#popupSaasWorkspace'].value, 'ws-b');
    assert.deepEqual(writes, [{ id: 'ws-b', manual: false }]);
  });

  it('用户手选的工作空间不被默认覆盖，也不重复落盘', async () => {
    const { sandbox, nodes, writes } = setup({ lastId: 'ws-c', manual: true, rows: THREE });
    await enterSaas(sandbox);
    assert.equal(nodes['#popupSaasWorkspace'].value, 'ws-c');
    assert.deepEqual(writes, []);
  });

  it('手动切换工作空间记为手选，后续不再被默认覆盖', async () => {
    const { sandbox, nodes, writes } = setup({ lastId: 'ws-b', manual: false, rows: THREE });
    await enterSaas(sandbox);
    assert.equal(nodes['#popupSaasWorkspace'].value, 'ws-b');
    nodes['#popupSaasWorkspace'].value = 'ws-a';
    nodes['#popupSaasWorkspace'].fire('change');
    await tick();
    assert.deepEqual(writes, [{ id: 'ws-a', manual: true }]);
  });

  it('自动选中后平台改默认，下次打开跟随新默认', async () => {
    const rows = [
      { id: 'ws-a', name: 'A' },
      { id: 'ws-b', name: 'B' },
      { id: 'ws-c', name: 'C', is_default: true },
    ];
    const { sandbox, nodes, writes } = setup({ lastId: 'ws-b', manual: false, rows });
    await enterSaas(sandbox);
    assert.equal(nodes['#popupSaasWorkspace'].value, 'ws-c');
    assert.deepEqual(writes, [{ id: 'ws-c', manual: false }]);
  });

  it('未登录占位不写 storage；direct 路由不加载', async () => {
    const { sandbox, nodes, writes } = setup({ rows: THREE });
    sandbox.window.PopupSaasWorkspace.syncRoute('direct');
    await tick();
    assert.equal(nodes['#popupSaasWorkspace'].value, '');
    assert.deepEqual(writes, []);
  });
});
