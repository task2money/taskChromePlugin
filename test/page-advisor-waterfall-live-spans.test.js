'use strict';

/**
 * 瀑布图须先展示细项，再随阶段推进更新耗时（禁止仅滚总时长、结束后才出细项）。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Timing = require('../lib/page-advisor-timing.js');
const View = require('../lib/page-advisor-waterfall-view.js');

describe('PageAdvisorTiming live planned spans', () => {
  it('seedPlannedSpans for builtin lists probe→infer before any work', () => {
    const run = Timing.createRun({
      runId: 'r-plan',
      command: 'alt-shift-z',
      route: 'builtin',
      now: () => 1000,
    });
    Timing.seedPlannedSpans(run);
    assert.deepEqual(run.spans.map((s) => s.id), [
      'capture', 'prompt',
      'builtin_probe', 'builtin_create', 'builtin_fit', 'builtin_infer', 'builtin_parse',
      'render',
    ]);
    assert.ok(run.spans.every((s) => s.status === 'pending'));
    const html = View.renderRun(run, (k) => k, (r) => Timing.layoutBars(r, () => 1000));
    assert.match(html, /data-span="builtin_infer"/);
    assert.match(html, /data-span="capture"/);
    assert.match(html, /pa-wf-bar-pending/);
  });

  it('startSpan activates a pending row; layoutBars grows running duration before end', () => {
    let t = 0;
    const now = () => t;
    const run = Timing.createRun({ runId: 'r-live', command: 'alt-z', route: 'builtin', now });
    Timing.seedPlannedSpans(run);
    t = 5;
    Timing.startSpan(run, 'capture', now);
    assert.equal(run.spans.find((s) => s.id === 'capture').status, 'running');
    assert.equal(run.spans.filter((s) => s.id === 'capture').length, 1);
    t = 55;
    const bars = Timing.layoutBars(run, now);
    const cap = bars.find((b) => b.id === 'capture');
    assert.equal(cap.status, 'running');
    assert.equal(cap.durationMs, 50);
    const infer = bars.find((b) => b.id === 'builtin_infer');
    assert.equal(infer.status, 'pending');
    assert.equal(infer.durationMs, 0);
  });

  it('withSpan onStart fires before the body progresses (for live broadcast)', async () => {
    let t = 0;
    const now = () => { t += 1; return t; };
    const run = Timing.createRun({ runId: 'r-hook', command: 'alt-z', route: 'direct', now });
    Timing.seedPlannedSpans(run);
    const events = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const pending = Timing.withSpan(run, 'capture', now, async () => {
      events.push('body-enter');
      await gate;
      events.push('body-done');
      return 'ok';
    }, {
      onStart: () => {
        events.push('start');
        assert.equal(run.spans.find((s) => s.id === 'capture').status, 'running');
      },
    });
    // async body runs to first await; onStart must still be first
    assert.equal(events[0], 'start');
    assert.ok(events.includes('body-enter'));
    assert.equal(events.includes('body-done'), false);
    release();
    assert.equal(await pending, 'ok');
    assert.deepEqual(events, ['start', 'body-enter', 'body-done']);
    assert.equal(run.spans.find((s) => s.id === 'capture').status, 'ok');
  });

  it('completeRun marks unused planned spans skipped (not ok)', () => {
    const now = () => 10;
    const run = Timing.createRun({ runId: 'r-skip', command: 'alt-z', route: 'builtin', now });
    Timing.seedPlannedSpans(run);
    Timing.startSpan(run, 'capture', now);
    Timing.endSpan(run, 'capture', now, 'ok');
    Timing.completeRun(run, now);
    assert.equal(run.spans.find((s) => s.id === 'capture').status, 'ok');
    assert.equal(run.spans.find((s) => s.id === 'builtin_infer').status, 'skipped');
  });
});
