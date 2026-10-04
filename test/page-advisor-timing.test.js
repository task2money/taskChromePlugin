'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Timing = require('../lib/page-advisor-timing.js');

describe('PageAdvisorTiming', () => {
  it('records sequential spans relative to run start', () => {
    let t = 1000;
    const now = () => t;
    const run = Timing.createRun({ runId: 'r1', command: 'alt-z', route: 'direct', now });
    Timing.startSpan(run, 'capture', now);
    t = 1080;
    Timing.endSpan(run, 'capture', now);
    Timing.startSpan(run, 'prompt', now);
    t = 1100;
    Timing.endSpan(run, 'prompt', now);
    const bars = Timing.layoutBars(run, now);
    assert.equal(run.spans[0].startMs, 0);
    assert.equal(run.spans[0].endMs, 80);
    assert.equal(run.spans[1].startMs, 80);
    assert.equal(run.spans[1].endMs, 100);
    assert.ok(bars[0].widthPct > 0);
    assert.ok(Math.abs(bars[0].widthPct + bars[1].widthPct - 100) < 0.01);
  });

  it('failRun marks open spans error and does not invent later spans', () => {
    let t = 0;
    const now = () => t;
    const run = Timing.createRun({ runId: 'r2', command: 'alt-shift-z', route: 'saas', now });
    Timing.startSpan(run, 'capture', now);
    t = 10;
    Timing.endSpan(run, 'capture', now);
    Timing.startSpan(run, 'saas_poll', now);
    t = 50;
    Timing.failRun(run, now, 'tid-1');
    assert.equal(run.status, 'error');
    assert.equal(run.traceId, 'tid-1');
    assert.equal(run.spans.length, 2);
    assert.equal(run.spans[1].status, 'error');
    assert.equal(run.spans[1].endMs, 50);
    assert.equal(run.spans.find((s) => s.id === 'render'), undefined);
  });

  it('serialize omits secrets and page text', () => {
    const run = Timing.createRun({ runId: 'r3', command: 'alt-z', route: 'direct', now: () => 1 });
    run.apiKey = 'sk-secret';
    run.pageText = 'SECRET_PAGE';
    const out = Timing.serialize(run);
    const blob = JSON.stringify(out);
    assert.doesNotMatch(blob, /sk-secret|SECRET_PAGE|apiKey|pageText/);
    assert.equal(out.runId, 'r3');
  });

  it('rememberHistory keeps latest 5 unique runIds', () => {
    const now = () => 1;
    const list = [];
    let hist = list;
    for (let i = 0; i < 6; i += 1) {
      const run = Timing.createRun({ runId: `r${i}`, command: 'alt-z', route: 'direct', now });
      Timing.completeRun(run, now);
      hist = Timing.rememberHistory(hist, run, 5);
    }
    assert.equal(hist.length, 5);
    assert.equal(hist[0].runId, 'r5');
    assert.equal(hist[4].runId, 'r1');
  });

  it('withSpan records ok and rethrows after error span', async () => {
    let t = 0;
    const now = () => { t += 5; return t; };
    const run = Timing.createRun({ runId: 'r4', command: 'alt-z', route: 'direct', now });
    const val = await Timing.withSpan(run, 'capture', now, async () => 'ok');
    assert.equal(val, 'ok');
    assert.equal(run.spans[0].status, 'ok');
    await assert.rejects(
      () => Timing.withSpan(run, 'prompt', now, async () => { throw new Error('boom'); }),
      /boom/,
    );
    assert.equal(run.spans[1].status, 'error');
  });
});

describe('PageAdvisorTiming network subspans (OPT-20261004-011)', () => {
  const ENTRY = { requestStart: 120, responseStart: 300, responseEnd: 460 };

  it('splits network into wait (TTFB) and download using timeOrigin', () => {
    const sub = Timing.networkSubspansFromEntry(ENTRY, 1_000_000);
    assert.deepEqual(sub, {
      waitStartMs: 1_000_120,
      waitEndMs: 1_000_300,
      downloadEndMs: 1_000_460,
      waitMs: 180,
      downloadMs: 160,
    });
  });

  it('returns null when the entry or timing is unusable (keeps whole-network behavior)', () => {
    assert.equal(Timing.networkSubspansFromEntry(null, 0), null);
    assert.equal(Timing.networkSubspansFromEntry(ENTRY, undefined), null);
    assert.equal(Timing.networkSubspansFromEntry(ENTRY, NaN), null);
    assert.equal(Timing.networkSubspansFromEntry({}, 0), null);
    assert.equal(Timing.networkSubspansFromEntry(
      { requestStart: 300, responseStart: 120, responseEnd: 460 }, 0), null); // 倒挂
    assert.equal(Timing.networkSubspansFromEntry(
      { requestStart: 120, responseStart: 460, responseEnd: 300 }, 0), null); // 倒挂
  });

  it('resourceEntryForUrl returns the latest matching entry and never throws', () => {
    const first = { responseEnd: 1 };
    const last = { responseEnd: 2 };
    const perf = { getEntriesByName: (name) => (name === 'https://llm.test/v1/chat/completions' ? [first, last] : []) };
    assert.equal(Timing.resourceEntryForUrl(perf, 'https://llm.test/v1/chat/completions'), last);
    assert.equal(Timing.resourceEntryForUrl(perf, 'https://other/'), null);
    assert.equal(Timing.resourceEntryForUrl(null, 'https://x/'), null);
    assert.equal(Timing.resourceEntryForUrl(perf, ''), null);
    assert.equal(Timing.resourceEntryForUrl({ getEntriesByName: () => { throw new Error('boom'); } }, 'u'), null);
    assert.equal(Timing.resourceEntryForUrl({ getEntriesByName: () => undefined }, 'u'), null);
  });
});
