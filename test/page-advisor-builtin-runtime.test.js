const { test } = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../lib/page-advisor-builtin-runtime.js');

function memStore(seed) {
  const data = { ...(seed || {}) };
  return {
    async get(key) {
      if (typeof key === 'string') return { [key]: data[key] };
      return { ...data };
    },
    async set(bag) {
      Object.assign(data, bag);
    },
    _data: data,
  };
}

test('sanitize 丢弃 pageText / apiKey', () => {
  const out = runtime.sanitize({
    phase: 'generating',
    pageText: 'SECRET_PAGE',
    apiKey: 'sk-leak',
    message: 'ok',
  });
  assert.equal(out.phase, 'generating');
  assert.equal(out.message, 'ok');
  assert.equal(out.pageText, undefined);
  assert.equal(out.apiKey, undefined);
});

test('write/read 合并 session 快照', async () => {
  const store = memStore();
  await runtime.write({ phase: 'collecting', availability: 'available' }, store);
  await runtime.write({ phase: 'generating', message: '推理中' }, store);
  const snap = await runtime.read(store);
  assert.equal(snap.phase, 'generating');
  assert.equal(snap.availability, 'available');
  assert.equal(snap.message, '推理中');
  assert.ok(snap.updatedAt > 0);
});

test('statusLine 按 phase 优先', () => {
  const tx = (k, vars) => (vars && vars.pct != null ? `${k}:${vars.pct}` : k);
  assert.equal(runtime.statusLine({ phase: 'generating', updatedAt: Date.now() }, tx), 'paBuiltinInferring');
  assert.equal(runtime.statusLine({ phase: 'downloading', downloadPct: 42 }, tx), 'paBuiltinDownloading:42');
  assert.equal(runtime.statusLine({ phase: 'idle', availability: 'downloadable' }, tx), 'paBuiltinNeedsDownload');
});

test('下载进度 100% 但仍 downloading 时不得显示尚未下载', () => {
  const tx = (k, vars) => (vars && vars.pct != null ? `${k}:${vars.pct}` : k);
  const snap = { phase: 'downloading', availability: 'downloading', downloadPct: 100 };
  assert.equal(runtime.statusLine(snap, tx), 'paBuiltinDownloadNeedEnable:100');
  assert.equal(runtime.statusLineForSettings(snap, tx), 'paBuiltinDownloadNeedEnable:100');
  assert.notEqual(runtime.statusLine(snap, tx), 'paBuiltinNeedsDownload');
});

test('点击下载后 100% 解压载入显示正在启用，而不是再点下载', () => {
  const tx = (k, vars) => (vars && vars.pct != null ? `${k}:${vars.pct}` : k);
  const snap = {
    phase: 'downloading',
    availability: 'downloading',
    downloadPct: 100,
    downloadInFlight: true,
  };
  assert.equal(runtime.statusLine(snap, tx), 'paBuiltinEnabling:100');
  assert.equal(runtime.statusLineForSettings(snap, tx), 'paBuiltinEnabling:100');
  assert.notEqual(runtime.statusLine(snap, tx), 'paBuiltinDownloadNeedEnable:100');
});

test('过期 collecting 不再挡住可用性文案', () => {
  const tx = (k) => k;
  const stale = {
    phase: 'collecting',
    availability: 'downloadable',
    updatedAt: Date.now() - 60_000,
  };
  assert.equal(runtime.statusLine(stale, tx), 'paBuiltinNeedsDownload');
  assert.equal(runtime.effectivePhase(stale), 'idle');
});

test('新鲜 collecting 仍显示采集中', () => {
  const tx = (k) => k;
  const fresh = { phase: 'collecting', availability: 'available', updatedAt: Date.now() };
  assert.equal(runtime.statusLine(fresh, tx), 'paCollecting');
});

test('设置页探测不得把卡住的 collecting 写回去', () => {
  const stale = { phase: 'collecting', updatedAt: Date.now() - 60_000 };
  assert.equal(runtime.phaseForSettingsProbe(stale, 'downloadable'), 'idle');
  assert.equal(
    runtime.phaseForSettingsProbe({ phase: 'collecting', updatedAt: Date.now() }, 'available', {
      clearInFlight: true,
    }),
    'idle',
  );
  assert.equal(
    runtime.phaseForSettingsProbe({ phase: 'downloading' }, 'downloading'),
    'downloading',
  );
});

test('刷新 clearInFlight 写入 downloadInFlight false（T1）', async () => {
  const store = memStore();
  await runtime.write({
    phase: 'downloading',
    availability: 'downloading',
    downloadPct: 100,
    downloadInFlight: true,
    enableStartedAt: Date.now(),
  }, store);
  await runtime.write({
    phase: runtime.phaseForSettingsProbe(
      await runtime.read(store),
      'downloading',
      { clearInFlight: true },
    ),
    availability: 'downloading',
    downloadInFlight: false,
  }, store);
  const snap = await runtime.read(store);
  assert.equal(snap.downloadInFlight, false);
  const tx = (k, vars) => (vars && vars.pct != null ? `${k}:${vars.pct}` : k);
  assert.equal(runtime.statusLine(snap, tx), 'paBuiltinDownloadNeedEnable:100');
});

test('100% inFlight 未超时仍是正在启用（T2）', () => {
  const tx = (k, vars) => (vars && vars.pct != null ? `${k}:${vars.pct}` : k);
  const snap = {
    phase: 'downloading',
    availability: 'downloading',
    downloadPct: 100,
    downloadInFlight: true,
    enableStartedAt: Date.now(),
  };
  assert.equal(runtime.isEnableStale(snap), false);
  assert.equal(runtime.statusLine(snap, tx), 'paBuiltinEnabling:100');
});

test('100% inFlight 超过 180s 恢复尚未启用（T3）', async () => {
  const store = memStore();
  const started = Date.now() - 200_000;
  await runtime.write({
    phase: 'downloading',
    availability: 'downloading',
    downloadPct: 100,
    downloadInFlight: true,
    enableHundredAt: started,
    enableStartedAt: started,
  }, store);
  const rec = await runtime.recoverIfStale(store, Date.now(), runtime.ENABLE_STALE_MS);
  assert.equal(rec.recovered, true);
  const tx = (k, vars) => (vars && vars.pct != null ? `${k}:${vars.pct}` : k);
  assert.equal(runtime.statusLine(rec.snap, tx), 'paBuiltinDownloadNeedEnable:100');
  assert.notEqual(runtime.statusLine(rec.snap, tx), 'paBuiltinEnabling:100');
});

test('设置页即使采集刚写入也不展示 paCollecting', () => {
  const tx = (k) => k;
  const fresh = {
    phase: 'collecting',
    availability: 'downloadable',
    updatedAt: Date.now(),
  };
  assert.equal(runtime.statusLine(fresh, tx), 'paCollecting');
  assert.equal(runtime.statusLineForSettings(fresh, tx), 'paBuiltinNeedsDownload');
  assert.equal(runtime.phaseForSettingsProbe(fresh, 'downloadable'), 'idle');
});
