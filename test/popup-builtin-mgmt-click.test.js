'use strict';

/**
 * 卡住采集中时，设置页按钮须立刻改文案（行为测，不只扫源码）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function makeEl() {
  return {
    hidden: false,
    textContent: '',
    disabled: false,
    _on: {},
    addEventListener(type, fn) { this._on[type] = fn; },
    setAttribute() {},
    removeAttribute() {},
    click() {
      const fn = this._on.click;
      return fn ? fn() : undefined;
    },
  };
}

function loadMgmt() {
  const status = makeEl();
  status.textContent = '正在采集页面并生成优化建议…';
  const refresh = makeEl();
  const download = makeEl();
  const basic = makeEl();
  const wrap = makeEl();
  wrap.hidden = false;
  const cancel = makeEl();
  cancel.hidden = true;
  const openFull = makeEl();
  const popupOnly = makeEl();
  popupOnly.hidden = true;
  const els = {
    '#popupBuiltinStatus': status,
    '#btnRefreshBuiltinStatus': refresh,
    '#btnDownloadBuiltinModel': download,
    '#popupBuiltinBasicMgmt': basic,
    '#popupLlmRouteBuiltinWrap': wrap,
    '#btnCancelBuiltinDownload': cancel,
    '#btnOpenBuiltinFullMgmt': openFull,
    '#btnDownloadBuiltinModelPopup': popupOnly,
  };
  const listeners = [];
  const store = {
    pageAdvisorBuiltinRuntime: {
      phase: 'collecting',
      availability: 'downloadable',
      updatedAt: Date.now(),
    },
  };
  const context = {
    console,
    ClickGuard: require('../lib/click-guard.js'),
    PageAdvisorBuiltinRuntime: require('../lib/page-advisor-builtin-runtime.js'),
    PageAdvisorBuiltinPrompt: {
      probe: async () => 'downloadable',
      promptLanguage: () => 'zh',
      startDownload: async (_lm, _loc, hooks) => {
        if (hooks && hooks.onProgress) hooks.onProgress(12);
      },
    },
    tx(k, vars) {
      const map = {
        paCollecting: '正在采集页面并生成优化建议…',
        paBuiltinRefreshing: '正在刷新内置模型状态…',
        paBuiltinDownloading: `正在下载内置模型… ${vars && vars.pct != null ? vars.pct : '…'}%`,
        paBuiltinNeedsDownload: '需要下载内置模型',
        paBuiltinFailed: '内置模型失败',
        paBuiltinReady: '就绪',
        paBuiltinUnavailable: '不可用',
        paBuiltinInferring: '正在推理…',
      };
      return map[k] || k;
    },
    document: {
      documentElement: { getAttribute: () => '' },
      querySelector: (sel) => els[sel] || null,
    },
    chrome: {
      storage: {
        session: {
          async get(key) { return { [key]: store[key] }; },
          async set(bag) {
            Object.assign(store, bag);
            const changes = {};
            Object.keys(bag).forEach((k) => {
              changes[k] = { newValue: bag[k] };
            });
            listeners.forEach((fn) => fn(changes, 'session'));
          },
        },
        onChanged: {
          addListener(fn) { listeners.push(fn); },
          removeListener(fn) {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
          },
        },
      },
      runtime: { sendMessage: () => Promise.resolve() },
    },
    LanguageModel: { availability: async () => 'downloadable' },
    window: { parent: { postMessage() {} } },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'popup/popup-builtin-mgmt.js'), 'utf8'), context);
  return { context, status, refresh, download, store };
}

test('刷新后设置行不再保持采集中，即使 session 仍有 collecting 心跳', async () => {
  const { context, status, refresh, store } = loadMgmt();
  context.PopupBuiltinMgmt.bindBuiltinMgmt(() => 'builtin');
  await context.PopupBuiltinMgmt.refreshBuiltinRoute(() => 'builtin');
  assert.notEqual(status.textContent, '正在采集页面并生成优化建议…');
  assert.equal(status.textContent, '需要下载内置模型');
  status.textContent = '正在采集页面并生成优化建议…';
  store.pageAdvisorBuiltinRuntime = {
    phase: 'collecting',
    availability: 'downloadable',
    updatedAt: Date.now(),
  };
  await refresh.click();
  assert.notEqual(status.textContent, '正在采集页面并生成优化建议…');
});

test('下载点击立刻离开采集中文案', async () => {
  const { context, status, download } = loadMgmt();
  context.PopupBuiltinMgmt.bindBuiltinMgmt(() => 'builtin');
  status.textContent = '正在采集页面并生成优化建议…';
  const p = download.click();
  assert.match(status.textContent, /下载/);
  assert.notEqual(status.textContent, '正在采集页面并生成优化建议…');
  await p;
});
