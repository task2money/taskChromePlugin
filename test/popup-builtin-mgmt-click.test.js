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

function loadMgmt(opts) {
  const probeAv = (opts && opts.availability) || 'downloadable';
  const seed = (opts && opts.runtime) || {
    phase: 'collecting',
    availability: 'downloadable',
    updatedAt: Date.now(),
  };
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
    pageAdvisorBuiltinRuntime: seed,
  };
  const context = {
    console,
    ClickGuard: require('../lib/click-guard.js'),
    PageAdvisorBuiltinRuntime: require('../lib/page-advisor-builtin-runtime.js'),
    PageAdvisorBuiltinPrompt: {
      probe: async () => probeAv,
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
        paBuiltinDownload: '下载模型',
        paBuiltinFinishEnable: '完成启用',
        paBuiltinNeedsDownload: '需要下载内置模型',
        paBuiltinFailed: '内置模型失败',
        paBuiltinDownloadNeedEnable: `内置模型已下载 ${vars && vars.pct != null ? vars.pct : '…'}%，尚未启用`,
        paBuiltinEnabling: `内置模型已下载 ${vars && vars.pct != null ? vars.pct : '…'}%，正在启用`,
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
    LanguageModel: { availability: async () => probeAv },
    window: {
      parent: { postMessage() {} },
      addEventListener(type, fn) {
        this._on = this._on || {};
        this._on[type] = fn;
      },
    },
  };
  context.globalThis = context;
  globalThis.chrome = context.chrome;
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

test('下载点击不得先 await 挂起的 storage 再 startDownload', async () => {
  const { context, download } = loadMgmt();
  let started = 0;
  const origWrite = context.PageAdvisorBuiltinRuntime.write;
  context.PageAdvisorBuiltinRuntime.write = (patch, storage) => {
    if (started === 0) return new Promise(() => {});
    return origWrite.call(context.PageAdvisorBuiltinRuntime, patch, storage);
  };
  context.PageAdvisorBuiltinPrompt.startDownload = async () => {
    started += 1;
  };
  context.PopupBuiltinMgmt.bindBuiltinMgmt(() => 'builtin');
  const done = download.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(started, 1, 'LanguageModel.create 必须在用户点击同步窗口内启动');
  await done;
});

test('刷新 downloading 100% 不得显示尚未下载', async () => {
  const { context, status, refresh } = loadMgmt({
    availability: 'downloading',
    runtime: {
      phase: 'downloading',
      availability: 'downloading',
      downloadPct: 100,
      updatedAt: Date.now(),
    },
  });
  context.PopupBuiltinMgmt.bindBuiltinMgmt(() => 'builtin');
  await refresh.click();
  await context.PopupBuiltinMgmt.refreshBuiltinRoute(() => 'builtin');
  assert.match(status.textContent, /尚未启用/);
  assert.notEqual(status.textContent, '需要下载内置模型');
  assert.equal(status.textContent.includes('尚未下载'), false);
});

test('刷新 inFlight 100% 后 session 不再 downloadInFlight', async () => {
  const { context, refresh, store } = loadMgmt({
    availability: 'downloading',
    runtime: {
      phase: 'downloading',
      availability: 'downloading',
      downloadPct: 100,
      downloadInFlight: true,
      enableStartedAt: Date.now(),
      updatedAt: Date.now(),
    },
  });
  context.PopupBuiltinMgmt.bindBuiltinMgmt(() => 'builtin');
  await refresh.click();
  const snap = store.pageAdvisorBuiltinRuntime;
  assert.equal(snap.downloadInFlight, false);
});

test('下载 100% 未启用时按钮文案改为「完成启用」', async () => {
  const { context, download } = loadMgmt({
    availability: 'downloading',
    runtime: {
      phase: 'downloading',
      availability: 'downloading',
      downloadPct: 100,
      downloadInFlight: false,
      updatedAt: Date.now(),
    },
  });
  context.PopupBuiltinMgmt.bindBuiltinMgmt(() => 'builtin');
  await context.PopupBuiltinMgmt.refreshBuiltinRoute(() => 'builtin');
  assert.equal(download.textContent, '完成启用');
});

test('下载未到 100% 时按钮仍为「下载模型」', async () => {
  const { context, download } = loadMgmt({
    availability: 'downloading',
    runtime: {
      phase: 'downloading',
      availability: 'downloading',
      downloadPct: 42,
      updatedAt: Date.now(),
    },
  });
  context.PopupBuiltinMgmt.bindBuiltinMgmt(() => 'builtin');
  await context.PopupBuiltinMgmt.refreshBuiltinRoute(() => 'builtin');
  assert.equal(download.textContent, '下载模型');
});

test('popup pagehide 调用 abandonEnable', () => {
  const { context } = loadMgmt();
  let n = 0;
  context.PageAdvisorBuiltinPrompt.abandonEnable = () => { n += 1; return true; };
  context.PopupBuiltinMgmt.bindBuiltinMgmt(() => 'builtin');
  assert.equal(typeof context.window._on.pagehide, 'function');
  context.window._on.pagehide();
  assert.equal(n, 1);
});
