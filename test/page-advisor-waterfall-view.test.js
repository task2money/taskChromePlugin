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

  it('shows backend forward sizes next to send and receive', () => {
    const run = Timing.createRun({ runId: 'fwd', command: 'alt-z', route: 'saas', now: () => 0 });
    Timing.addClosedSpan(run, 'saas_poll', 0, 24000, 'ok');
    Timing.applySaasForward(run, {
      send_ms: 12, wait_ms: 23000, recv_ms: 40, request_bytes: 8421, response_bytes: 3102,
    });
    const html = View.renderRun(run, (k) => ({
      paWfSaasFwdSend: '发送请求',
      paWfSaasFwdWait: '上游等待',
      paWfSaasFwdRecv: '接收响应',
      paWfSaasFwdQueue: '平台排队',
    }[k] || k), (r) => Timing.layoutBars(r, () => 24000));
    assert.match(html, /发送请求/);
    assert.match(html, /12ms · 8\.2KB/);
    assert.match(html, /上游等待/);
    assert.match(html, /23\.00s/);
    assert.match(html, /40ms · 3\.0KB/);
    assert.doesNotMatch(html, /data-span="saas_poll"/);
  });
});
