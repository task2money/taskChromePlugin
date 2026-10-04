'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

require('../lib/page-advisor-builtin-runtime.js');
const enable = require('../lib/page-advisor-builtin-enable.js');

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
  };
}

test('waitIfEnabling 偏死后清 inFlight 且不 probe', async () => {
  const runtime = require('../lib/page-advisor-builtin-runtime.js');
  const store = memStore();
  const started = Date.now() - 200_000;
  await runtime.write({
    phase: 'downloading',
    availability: 'downloading',
    downloadPct: 100,
    downloadInFlight: true,
    enableHundredAt: started,
  }, store);
  const prev = globalThis.PageAdvisorBuiltinRuntime;
  const prevChrome = globalThis.chrome;
  globalThis.PageAdvisorBuiltinRuntime = {
    ...runtime,
    read: () => runtime.read(store),
    write: (patch) => runtime.write(patch, store),
    recoverIfStale: (s, now, ms) => runtime.recoverIfStale(s || store, now, ms),
  };
  globalThis.chrome = {
    storage: { session: store },
  };
  let probes = 0;
  const notes = [];
  try {
    await enable.waitIfEnabling({}, 'zh-CN', 1, {
      enableTimeoutMs: runtime.ENABLE_STALE_MS,
      probe: async () => {
        probes += 1;
        return 'downloading';
      },
      notify: async (_tab, payload) => { notes.push(payload); },
      tx: (k, vars) => `${k}:${vars && vars.loadPct != null ? vars.loadPct : ''}`,
    });
  } finally {
    globalThis.PageAdvisorBuiltinRuntime = prev;
    globalThis.chrome = prevChrome;
  }
  const snap = await runtime.read(store);
  assert.equal(snap.downloadInFlight, false);
  assert.equal(probes, 0);
  assert.equal(notes.length, 0);
});
