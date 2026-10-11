'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../lib/page-advisor-builtin-last-run.js');
const PopupWf = require('../popup/popup-waterfall.js');

function fakeDoc(host) {
  const attrs = host ? { 'data-taskplugin-host': host } : {};
  const label = { textContent: '使用浏览器内置模型' };
  return {
    documentElement: {
      getAttribute(name) { return attrs[name] || null; },
    },
    querySelector(sel) {
      return sel === '[data-i18n="paLlmRouteBuiltin"]' ? label : null;
    },
    label,
  };
}

describe('popup page-advisor waterfall host', () => {
  it('设置页与本机模型页不再挂载耗时条', () => {
    assert.equal(PopupWf.mount(fakeDoc('')), null);
    assert.equal(PopupWf.mount(fakeDoc('popup')), null);
    assert.equal(PopupWf.mount(fakeDoc('sidepanel')), null);
    assert.equal(typeof PopupWf.SLOTS, 'undefined');
  });

  it('popup.html 把打开完整管理放在内置模型后面，且没有刷新和耗时条', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup.html'), 'utf8');
    const builtinAt = html.indexOf('id="popupLlmRouteBuiltin"');
    const openAt = html.indexOf('id="btnOpenBuiltinFullMgmt"');
    const downloadAt = html.indexOf('id="btnDownloadBuiltinModel"');
    assert.ok(builtinAt >= 0 && openAt > builtinAt && downloadAt > openAt);
    assert.doesNotMatch(html, /id="btnRefreshBuiltinStatus"/);
    assert.doesNotMatch(html, /id="pageAdvisorWaterfall"/);
    assert.doesNotMatch(html, /data-i18n="paWfHelp"/);
    assert.match(html, /popup-waterfall\.js/);
  });

  it('sidepanel.html 不再放刷新按钮和耗时条', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.html'), 'utf8');
    assert.doesNotMatch(html, /id="spBuiltinRefresh"/);
    assert.doesNotMatch(html, /id="pageAdvisorWaterfallBuiltin"/);
    assert.match(html, /popup-waterfall\.js/);
    assert.match(html, /id="spBuiltinDownload"/);
  });

  it('成功的本机运行仍写入最近耗时并刷新选项文案', async () => {
    const store = {};
    globalThis.chrome = {
      storage: {
        local: {
          async get() { return { ...store }; },
          async set(bag) { Object.assign(store, bag); },
        },
      },
    };
    globalThis.tx = (key) => {
      if (key === 'paLlmRouteBuiltin') return '使用浏览器内置模型';
      if (key === 'paLlmRouteBuiltinMeasured') return '使用浏览器内置模型（本机最近约 {sec}s）';
      return key;
    };
    const doc = fakeDoc('sidepanel');
    PopupWf.mount(doc);
    const ms = await PopupWf.applyRun({
      route: 'builtin',
      status: 'ok',
      startedAt: 0,
      endedAt: 3200,
      spans: [],
    });
    assert.equal(ms, 3200);
    assert.match(doc.label.textContent, /3s/);
  });
});
