'use strict';

/**
 * 侧栏内置模型下载按钮：字节下完但仍报 downloading 时文案应为「完成启用」（行为测）。
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
  };
}

function loadPanel(downloadPct) {
  const els = {
    '#spBuiltinStatus': makeEl(),
    '#spBuiltinParams': makeEl(),
    '#spBuiltinQuota': makeEl(),
    '#spBuiltinLastRun': makeEl(),
    '#spBuiltinDownload': makeEl(),
    '#spBuiltinCancel': makeEl(),
    '#sp-tab-builtin': makeEl(),
  };
  const context = {
    console,
    LanguageModel: { availability: async () => 'downloading' },
    PageAdvisorBuiltinPrompt: {
      probe: async () => 'downloading',
      promptLanguage: () => 'zh',
    },
    PageAdvisorBuiltinRuntime: {
      read: async () => ({
        phase: 'downloading',
        availability: 'downloading',
        downloadPct,
        updatedAt: 1,
      }),
      write: async () => {},
      statusLineForSettings: () => 'line',
      phaseForSettingsProbe: () => 'downloading',
    },
    tx(key) {
      const map = {
        paBuiltinDownload: '下载模型',
        paBuiltinFinishEnable: '完成启用',
      };
      return map[key] || key;
    },
    document: {
      readyState: 'complete',
      addEventListener() {},
      querySelector: (sel) => els[sel] || null,
    },
    chrome: {
      storage: { onChanged: { addListener() {}, removeListener() {} } },
    },
  };
  context.globalThis = context;
  const prevChrome = globalThis.chrome;
  globalThis.chrome = context.chrome;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'sidepanel/builtin-model-panel.js'), 'utf8'),
    context,
  );
  globalThis.chrome = prevChrome;
  return { context, download: els['#spBuiltinDownload'] };
}

test('downloading 100% 时按钮文案为「完成启用」', async () => {
  const { context, download } = loadPanel(100);
  await context.SidepanelBuiltinPanel.probeDetails();
  assert.equal(download.textContent, '完成启用');
});

test('downloading 未满 100% 时按钮文案为「下载模型」', async () => {
  const { context, download } = loadPanel(42);
  await context.SidepanelBuiltinPanel.probeDetails();
  assert.equal(download.textContent, '下载模型');
});
