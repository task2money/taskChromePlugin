'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../lib/page-advisor-timing.js');
require('../lib/page-advisor-waterfall-view.js');
const PopupWf = require('../popup/popup-waterfall.js');

function fakeDoc(host, extras) {
  const attrs = host ? { 'data-taskplugin-host': host } : {};
  const nodes = {};
  function makeParent() {
    return {
      appendChild(el) { nodes[el.id] = el; return el; },
    };
  }
  if (!extras || extras.llm !== false) {
    nodes.pageAdvisorLlmSection = makeParent();
  }
  if (extras && extras.builtin) {
    nodes.spBuiltinPanel = makeParent();
  }
  return {
    documentElement: {
      getAttribute(name) { return attrs[name] || null; },
    },
    getElementById(id) { return nodes[id] || null; },
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(),
        id: '',
        className: '',
        hidden: false,
        innerHTML: '',
        setAttribute(name, value) { this[name] = value; },
      };
      return el;
    },
  };
}

describe('popup page-advisor waterfall host', () => {
  it('mounts only when host is sidepanel', () => {
    assert.equal(PopupWf.mount(fakeDoc('')), null);
    assert.equal(PopupWf.mount(fakeDoc('popup')), null);
    const el = PopupWf.mount(fakeDoc('sidepanel'));
    assert.ok(el);
    assert.equal(el.id, 'pageAdvisorWaterfall');
    assert.equal(el.hidden, false);
  });

  it('popup.html keeps waterfall after llm status and loads scripts', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup.html'), 'utf8');
    const statusAt = html.indexOf('id="popupLlmStatus"');
    const wfAt = html.indexOf('id="pageAdvisorWaterfall"');
    assert.ok(statusAt >= 0 && wfAt > statusAt);
    assert.match(html, /popup-waterfall\.js/);
    assert.match(html, /page-advisor-timing\.js/);
    assert.match(html, /data-i18n="paWfHelp"/);
  });

  it('mounts waterfall under 本机模型 panel when settings section is absent', () => {
    const el = PopupWf.mount(fakeDoc('sidepanel', { llm: false, builtin: true }));
    assert.ok(el);
    assert.equal(el.id, 'pageAdvisorWaterfallBuiltin');
    assert.equal(el.hidden, false);
  });

  it('applyRun paints settings and 本机模型 slots together', () => {
    const doc = fakeDoc('sidepanel', { builtin: true });
    PopupWf.mount(doc);
    const settings = doc.getElementById('pageAdvisorWaterfall');
    const builtin = doc.getElementById('pageAdvisorWaterfallBuiltin');
    assert.ok(settings && builtin);
    PopupWf.applyRun({
      runId: 'r1',
      status: 'ok',
      startedAt: 0,
      endedAt: 10,
      spans: [{ id: 'builtin_infer', startMs: 0, endMs: 10, status: 'ok' }],
    });
    assert.match(settings.innerHTML, /data-span="builtin_infer"/);
    assert.match(builtin.innerHTML, /data-span="builtin_infer"/);
  });

  it('本机模型 Tab 仅在非 builtin 路由时给出说明行（OPT-20261005-004）', () => {
    const doc = fakeDoc('sidepanel', { builtin: true });
    PopupWf.mount(doc);
    const settings = doc.getElementById('pageAdvisorWaterfall');
    const builtin = doc.getElementById('pageAdvisorWaterfallBuiltin');

    // 平台/直连路由：本机模型 Tab 顶部提示，设置 Tab 不提示。
    PopupWf.applyRun({
      runId: 'r-platform',
      route: 'platform',
      status: 'ok',
      startedAt: 0,
      endedAt: 10,
      spans: [{ id: 'builtin_infer', startMs: 0, endMs: 10, status: 'ok' }],
    });
    assert.match(builtin.innerHTML, /pa-wf-route-notice/);
    assert.doesNotMatch(settings.innerHTML, /pa-wf-route-notice/);

    // builtin 路由：两个 Tab 都不提示。
    PopupWf.applyRun({
      runId: 'r-builtin',
      route: 'builtin',
      status: 'ok',
      startedAt: 0,
      endedAt: 10,
      spans: [{ id: 'builtin_infer', startMs: 0, endMs: 10, status: 'ok' }],
    });
    assert.doesNotMatch(builtin.innerHTML, /pa-wf-route-notice/);
  });

  it('sidepanel.html 本机模型 Tab has waterfall slot and loads paint scripts', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.html'), 'utf8');
    const lastAt = html.indexOf('id="spBuiltinLastRun"');
    const wfAt = html.indexOf('id="pageAdvisorWaterfallBuiltin"');
    assert.ok(lastAt >= 0 && wfAt > lastAt);
    assert.match(html, /popup-waterfall\.js/);
    assert.match(html, /page-advisor-waterfall-view\.js/);
    assert.match(html, /page-advisor-timing\.js/);
  });
});
