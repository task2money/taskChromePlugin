'use strict';

/**
 * 未登录选 system 不得 getSystemAgents，且不露出 select；登录后才拉 SKU。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'lib', 'popup-system-sku.js');
const MODULE = path.join(ROOT, 'popup', 'popup-system-sku.js');

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
    style: { display: '' },
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
  };
  return el;
}

function setup() {
  const nodes = {
    '#popupLlmSystemSkuRow': makeElement('div'),
    '#popupLlmSystemSku': makeElement('select'),
    '#popupLlmSystemLoginHint': makeElement('p'),
    '#popupLlmSystemSkuStatus': makeElement('p'),
    '#popupLlmSystemSkuRetry': makeElement('button'),
  };
  nodes['#popupLlmSystemSkuRow'].hidden = true;
  nodes['#popupLlmSystemSkuRetry'].hidden = true;
  nodes['#popupLlmSystemLoginHint'].hidden = true;
  nodes['#popupLlmSystemSku'].hidden = true;

  const sent = [];
  const prompts = [];
  const sandbox = {
    document: {
      readyState: 'complete',
      querySelector: (sel) => nodes[sel] || null,
      createElement: (tag) => makeElement(tag),
      addEventListener() {},
    },
    window: {
      PopupAuth: {
        promptLogin(opts) { prompts.push(opts || {}); },
      },
    },
    console: { warn() {}, log() {}, error() {} },
    tx: (key, params) => (params?.msg ? `${key}:${params.msg}` : key),
    setDataTraceId(el, err) {
      const id = (err && (err.traceId || err.trace_id)) || '';
      if (id) el['data-traceId'] = id;
      else delete el['data-traceId'];
    },
    PageAdvisorLlmConfig: {
      loadFromStorage: async () => ({ routeMode: 'system', systemSkuId: 'sku-b' }),
      saveToStorage: async (cfg) => cfg,
    },
    sendMessageWithTimeout: (msg) => {
      sent.push(msg);
      return sandbox.__respond(msg);
    },
    __respond: (msg) => {
      if (msg && msg.action === 'getOwnAgents') {
        return Promise.resolve({
          success: true,
          data: {
            providers: [{
              provider: 'deepseek',
              remark: '公司主账号',
              supported_models: ['deepseek-chat'],
            }],
          },
        });
      }
      return Promise.resolve({
        success: true,
        data: { items: [{ id: 'sku-a', name: '甲' }, { id: 'sku-b', name: '乙' }] },
      });
    },
    ClickGuard: undefined,
  };
  sandbox.globalThis = sandbox;
  sandbox.window.PopupSystemSku = undefined;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(LIB, 'utf8'), sandbox, { filename: 'popup-system-sku.js' });
  vm.runInContext(fs.readFileSync(MODULE, 'utf8'), sandbox, { filename: 'popup-system-sku-ui.js' });
  return { sandbox, nodes, sent, prompts };
}

function skuCalls(sent) {
  return sent.filter((m) => m && m.action === 'getSystemAgents');
}

function optionLabels(sel) {
  const out = [];
  for (const node of sel.childNodes || []) {
    if (Array.isArray(node.childNodes) && node.childNodes.length) {
      for (const child of node.childNodes) out.push(child.textContent);
    } else {
      out.push(node.textContent);
    }
  }
  return out;
}

describe('Popup 系统智能体：登录后再拉下拉', () => {
  it('saas 未登录：提示登录、隐藏 select、不发 getSystemAgents', async () => {
    const { sandbox, nodes, sent, prompts } = setup();
    sandbox.window.PopupSystemSku.setLoggedIn(false);
    sandbox.window.PopupSystemSku.syncRoute('saas');
    await Promise.resolve();
    assert.equal(nodes['#popupLlmSystemSkuRow'].hidden, false);
    assert.equal(nodes['#popupLlmSystemLoginHint'].hidden, false);
    assert.equal(nodes['#popupLlmSystemSku'].hidden, true);
    assert.equal(skuCalls(sent).length, 0);
    assert.equal(prompts.length, 1);
  });

  it('saas 已登录：显示自有+系统 SKU 并发 getSystemAgents', async () => {
    const { sandbox, nodes, sent } = setup();
    sandbox.window.PopupSystemSku.setLoggedIn(true);
    sandbox.window.PopupSystemSku.syncRoute('saas');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(nodes['#popupLlmSystemSku'].hidden, false);
    assert.equal(nodes['#popupLlmSystemLoginHint'].hidden, true);
    assert.equal(skuCalls(sent).length, 1);
    assert.equal(sent.filter((m) => m && m.action === 'getOwnAgents').length, 1);
    assert.deepEqual(optionLabels(nodes['#popupLlmSystemSku']), ['公司主账号*deepseek-chat', '甲', '乙']);
    assert.equal(nodes['#popupLlmSystemSku'].value, 'system:sku-b');
  });

  it('direct 隐藏行且不拉列表', async () => {
    const { sandbox, nodes, sent } = setup();
    sandbox.window.PopupSystemSku.setLoggedIn(true);
    sandbox.window.PopupSystemSku.syncRoute('direct');
    await Promise.resolve();
    assert.equal(nodes['#popupLlmSystemSkuRow'].hidden, true);
    assert.equal(skuCalls(sent).length, 0);
  });
});
