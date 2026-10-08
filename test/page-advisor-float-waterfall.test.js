'use strict';


const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadLibs() {
  const sandbox = {
    console,
    Date,
    setInterval,
    clearInterval,
    tx: (k) => ({
      paLoading: '正在采集页面并生成优化建议…',
      paWfCapture: '采集',
      paWfPrompt: '提示',
      paWfPendingMs: '—',
      paWfStatusRunning: '进行中',
    }[k] || k),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const rel of [
    'lib/page-advisor-timing.js',
    'lib/page-advisor-waterfall-view.js',
    'lib/page-advisor-float-waterfall.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
  }
  return sandbox;
}

function runningRun(sandbox, nowMs) {
  const Timing = sandbox.PageAdvisorTiming;
  const t0 = 1700000000000;
  const run = Timing.createRun({ route: 'saas', runId: 'r1', now: () => t0 });
  Timing.seedPlannedSpans(run);
  Timing.startSpan(run, 'capture', () => t0);
  Timing.endSpan(run, 'capture', () => t0 + 1500);
  Timing.startSpan(run, 'prompt', () => t0 + 1500);
  return run;
}

describe('page advisor collecting panel waterfall', () => {
  it('paints live stage timings into the collecting host', () => {
    const sandbox = loadLibs();
    const t0 = 1700000000000;
    const orig = Date.now;
    Date.now = () => t0 + 9500;
    try {
      const run = runningRun(sandbox);
      const host = { hidden: true, innerHTML: '' };
      const doc = {
        getElementById: (id) => (id === 'taskplugin-page-advisor-waterfall' ? host : null),
      };
      sandbox.PageAdvisorFloatWaterfall.applyRun(run, doc);
      assert.match(host.innerHTML, /采集/);
      assert.match(host.innerHTML, /提示/);
      assert.match(host.innerHTML, /1\.50s/);
      assert.match(host.innerHTML, /8\.00s/);
      assert.equal(host.hidden, false);
    } finally {
      Date.now = orig;
    }
  });

  it('keeps the collecting sentence outside the ticking chart', () => {
    const sandbox = loadLibs();
    const t0 = 1700000000000;
    const orig = Date.now;
    Date.now = () => t0 + 9500;
    try {
      const run = runningRun(sandbox);
      sandbox.PageAdvisorFloatWaterfall.applyRun(run, { getElementById: () => null });
      const html = sandbox.PageAdvisorFloatWaterfall.statusCardHtml('正在采集页面并生成优化建议…', (s) => s);
      const status = html.match(/role="status"[^>]*>[\s\S]*?<\/div>/);
      assert.ok(status, html);
      assert.match(status[0], /正在采集页面并生成优化建议…/);
      assert.doesNotMatch(status[0], /pa-wf|data-span/);
      assert.match(html, /aria-hidden="true"/);
      assert.match(html, /1\.50s/);
    } finally {
      Date.now = orig;
    }
  });

  it('showPageAdvisorLoading mounts the sentence and the waterfall host', () => {
    const sandbox = loadLibs();
    const t0 = 1700000000000;
    const orig = Date.now;
    Date.now = () => t0 + 9500;
    const cards = { innerHTML: '' };
    const live = { textContent: '' };
    try {
      const run = runningRun(sandbox);
      sandbox.PageAdvisorFloatWaterfall.applyRun(run, { getElementById: () => null });
      sandbox.esc = (s) => String(s ?? '');
      sandbox.ensurePageAdvisorLayer = () => ({ hidden: false });
      sandbox.syncPageAdvisorFillButtons = () => {};
      sandbox.showPageAdvisorLayer = () => {};
      sandbox.collapseFloatPanelDuringAdvisor = () => {};
      sandbox.setPageAdvisorError = () => {};
      const layer = { hidden: true };
      sandbox.document = {
        getElementById(id) {
          if (id === 'taskplugin-page-advisor-layer') return layer;
          if (id === 'taskplugin-page-advisor-cards') return cards;
          if (id === 'taskplugin-page-advisor-live') return live;
          if (id === 'taskplugin-page-advisor-links') return { hidden: true, innerHTML: '' };
          return null;
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
      };
      vm.runInContext(
        fs.readFileSync(path.join(ROOT, 'content/float-page-advisor.js'), 'utf8'),
        sandbox,
        { filename: 'float-page-advisor.js' },
      );
      sandbox.showPageAdvisorLoading();
      assert.match(cards.innerHTML, /role="status"[^>]*>正在采集页面并生成优化建议…<\/div>/);
      assert.match(cards.innerHTML, /1\.50s/);
      assert.match(cards.innerHTML, /data-testid="page-advisor-float-waterfall"/);
      assert.equal(live.textContent, '正在采集页面并生成优化建议…');
    } finally {
      Date.now = orig;
    }
  });

  it('采集进行中按环节低频播报当前环节与已用秒数', () => {
    const sandbox = loadLibs();
    const t0 = 1700000000000;
    const orig = Date.now;
    Date.now = () => t0 + 9500;
    try {
      sandbox.tx = (k, p) => {
        if (k === 'paWfAnnounce') return `当前环节：${p.stage}，已用 ${p.seconds} 秒`;
        return ({ paWfCapture: '采集', paWfPrompt: '提示', paWfParse: '解析' }[k] || k);
      };
      const run = runningRun(sandbox);
      const host = { hidden: true, innerHTML: '' };
      const announce = { textContent: '' };
      const doc = {
        getElementById: (id) => {
          if (id === 'taskplugin-page-advisor-waterfall-announce') return announce;
          if (id === 'taskplugin-page-advisor-waterfall') return host;
          return null;
        },
      };
      sandbox.PageAdvisorFloatWaterfall.applyRun(run, doc);
      assert.equal(announce.textContent, '当前环节：提示，已用 10 秒');

      // 同一环节 5 秒内不重复播报（避免 250ms 重绘刷屏）
      announce.textContent = '';
      sandbox.PageAdvisorFloatWaterfall.maybeAnnounce(doc);
      assert.equal(announce.textContent, '');

      // 环节切换立刻播报，不等满 5 秒
      sandbox.PageAdvisorTiming.startSpan(run, 'parse', () => t0 + 9500);
      Date.now = () => t0 + 9600;
      sandbox.PageAdvisorFloatWaterfall.maybeAnnounce(doc);
      assert.equal(announce.textContent, '当前环节：解析，已用 10 秒');
    } finally {
      Date.now = orig;
    }
  });

  it('播报节点在 aria-hidden 图表之外', () => {
    const sandbox = loadLibs();
    const html = sandbox.PageAdvisorFloatWaterfall.statusCardHtml('正在采集页面并生成优化建议…', (s) => s);
    const announceIdx = html.indexOf('taskplugin-page-advisor-waterfall-announce');
    const hiddenIdx = html.indexOf('aria-hidden="true"');
    assert.ok(announceIdx >= 0, html);
    assert.ok(hiddenIdx > announceIdx, '播报节点必须在 aria-hidden 图表之前/之外');
    assert.match(html, /id="taskplugin-page-advisor-waterfall-announce"[^>]*role="status"/);
  });

  it('content script list loads timing before the collecting panel', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const js = manifest.content_scripts[0].js;
    const timing = js.indexOf('lib/page-advisor-timing.js');
    const view = js.indexOf('lib/page-advisor-waterfall-view.js');
    const floatWf = js.indexOf('lib/page-advisor-float-waterfall.js');
    const panel = js.indexOf('content/float-page-advisor.js');
    assert.ok(timing >= 0 && view > timing && floatWf > view && panel > floatWf);
  });
});
