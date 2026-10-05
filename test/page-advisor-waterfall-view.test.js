'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const View = require('../lib/page-advisor-waterfall-view.js');
const Timing = require('../lib/page-advisor-timing.js');

describe('PageAdvisorWaterfallView', () => {
  it('idle copy is text-escaped and uses paWfIdle', () => {
    const html = View.renderIdle((k) => (k === 'paWfIdle' ? '按 Alt+Z' : k));
    assert.match(html, /paWfIdle/);
    assert.match(html, /按 Alt\+Z/);
  });

  it('renders bars for a completed run without injecting raw html from labels', () => {
    let t = 0;
    const now = () => t;
    const run = Timing.createRun({ runId: 'r', command: 'alt-z', route: 'direct', now });
    Timing.startSpan(run, 'capture', now);
    t = 40;
    Timing.endSpan(run, 'capture', now);
    Timing.completeRun(run, now);
    const html = View.renderRun(run, (k) => (k === 'paWfCapture' ? '<x>' : k), (r) => Timing.layoutBars(r, now));
    assert.match(html, /&lt;x&gt;/);
    assert.doesNotMatch(html, /<x>/);
    assert.match(html, /pa-wf-bar-capture/);
    assert.match(html, /paWfStatusOk/);
  });

  it('成功运行默认隐藏 skipped 细项并给出切换按钮（OPT-20261005-003）', () => {
    let t = 0;
    const now = () => t;
    const run = Timing.createRun({ runId: 'skip', command: 'alt-z', route: 'direct', now });
    Timing.seedPlannedSpans(run);
    Timing.startSpan(run, 'capture', now);
    t = 20;
    Timing.endSpan(run, 'capture', now);
    Timing.completeRun(run, now);
    const layout = (r) => Timing.layoutBars(r, now);

    const hidden = View.renderRun(run, (k) => k, layout, { hideSkipped: true });
    assert.doesNotMatch(hidden, /data-span="llm_wait"/);
    assert.match(hidden, /pa-wf-toggle-skipped/);
    assert.match(hidden, /paWfShowSkipped/);

    const shown = View.renderRun(run, (k) => k, layout, { hideSkipped: false });
    assert.match(shown, /data-span="llm_wait"/);
    assert.match(shown, /paWfHideSkipped/);
  });

  it('error span uses pa-wf-bar-error', () => {
    let t = 0;
    const now = () => t;
    const run = Timing.createRun({ runId: 'e', command: 'alt-z', route: 'direct', now });
    Timing.startSpan(run, 'network', now);
    t = 10;
    Timing.failRun(run, now, 'tid');
    const html = View.renderRun(run, (k) => k, (r) => Timing.layoutBars(r, now));
    assert.match(html, /pa-wf-bar-error/);
    assert.match(html, /paWfStatusError/);
  });
});
