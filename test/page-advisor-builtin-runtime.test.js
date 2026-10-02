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
  assert.equal(runtime.statusLine({ phase: 'generating' }, tx), 'paBuiltinInferring');
  assert.equal(runtime.statusLine({ phase: 'downloading', downloadPct: 42 }, tx), 'paBuiltinDownloading:42');
  assert.equal(runtime.statusLine({ phase: 'idle', availability: 'downloadable' }, tx), 'paBuiltinNeedsDownload');
});
