'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const progress = require('../lib/page-advisor-builtin-progress.js');
const runtime = require('../lib/page-advisor-builtin-runtime.js');

test('applyProgressBar 隐藏与确定进度', () => {
  const el = {
    hidden: false,
    max: 100,
    value: 0,
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; delete this[k]; },
  };
  progress.applyProgressBar(el, { visible: false });
  assert.equal(el.hidden, true);
  progress.applyProgressBar(el, { visible: true, value: 42, max: 100, kind: 'download' });
  assert.equal(el.hidden, false);
  assert.equal(el.value, 42);
  assert.equal(el.attrs['data-kind'], 'download');
});

test('heartbeat 按等待时间推进 enablePct，不钉在 1', async () => {
  const store = {
    async get(key) { return { [key]: this.data[key] }; },
    async set(bag) { Object.assign(this.data, bag); },
    data: {},
  };
  const prev = globalThis.PageAdvisorBuiltinRuntime;
  const prevChrome = globalThis.chrome;
  globalThis.PageAdvisorBuiltinRuntime = runtime;
  globalThis.chrome = { storage: { session: store } };
  await runtime.write({
    phase: 'downloading',
    availability: 'downloading',
    downloadPct: 100,
    downloadInFlight: true,
    enableHundredAt: Date.now() - 25_000,
    enablePct: 1,
  }, store);
  try {
    const ticks = [];
    const handle = progress.startEnableHeartbeat({
      intervalMs: 10,
      probe: async () => 'downloading',
      onTick(loadPct) { ticks.push(loadPct); },
    });
    await new Promise((r) => setTimeout(r, 30));
    handle.stop();
    assert.ok(ticks.length >= 1);
    assert.ok(ticks.some((p) => p >= 50), String(ticks[ticks.length - 1]));
    const snap = await runtime.read(store);
    assert.ok(Number(snap.enablePct) >= 50, String(snap.enablePct));
    assert.equal(snap.downloadInFlight, true);
  } finally {
    globalThis.PageAdvisorBuiltinRuntime = prev;
    globalThis.chrome = prevChrome;
  }
});

test('heartbeat 探测 available 后写就绪', async () => {
  const store = {
    async get(key) { return { [key]: this.data[key] }; },
    async set(bag) { Object.assign(this.data, bag); },
    data: {},
  };
  const prev = globalThis.PageAdvisorBuiltinRuntime;
  const prevChrome = globalThis.chrome;
  globalThis.PageAdvisorBuiltinRuntime = runtime;
  globalThis.chrome = { storage: { session: store } };
  await runtime.write({
    phase: 'downloading',
    availability: 'downloading',
    downloadPct: 100,
    downloadInFlight: true,
    enableHundredAt: Date.now(),
    enablePct: 1,
  }, store);
  let av = 'downloading';
  try {
    const handle = progress.startEnableHeartbeat({
      intervalMs: 10,
      probe: async () => av,
      languageModel: {},
      locale: 'zh-CN',
    });
    await new Promise((r) => setTimeout(r, 20));
    av = 'available';
    await new Promise((r) => setTimeout(r, 25));
    handle.stop();
    const snap = await runtime.read(store);
    assert.equal(snap.availability, 'available');
    assert.equal(snap.downloadInFlight, false);
    assert.equal(snap.enablePct, 100);
  } finally {
    globalThis.PageAdvisorBuiltinRuntime = prev;
    globalThis.chrome = prevChrome;
  }
});

test('popup 与侧栏挂载解压进度条', () => {
  const popup = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
  const side = fs.readFileSync(path.join(__dirname, '../sidepanel/sidepanel.html'), 'utf8');
  assert.match(popup, /id="popupBuiltinProgress"/);
  assert.match(side, /id="spBuiltinProgress"/);
});
