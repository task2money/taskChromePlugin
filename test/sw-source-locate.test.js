'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const Sw = require('../background/sw-source-locate.js');

const REAL_FETCH = global.fetch;

function textResponse(text) {
  const bytes = new TextEncoder().encode(String(text));
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer,
  };
}

function makeFetch(files, opts = {}) {
  const calls = [];
  const hang = new Set(opts.hang || []);
  const fetch = async (url, init = {}) => {
    calls.push(url);
    const signal = init && init.signal;
    if (signal && signal.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    if (hang.has(url)) {
      return new Promise((resolve, reject) => {
        if (!signal) return;
        signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      });
    }
    if (!Object.prototype.hasOwnProperty.call(files, url)) {
      return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return textResponse(files[url]);
  };
  return { fetch, calls };
}

function standardFiles() {
  return {
    'https://site.test/app.js': 'var x="toolbar-selection";\n//# sourceMappingURL=app.js.map',
    'https://site.test/app.js.map': JSON.stringify({
      version: 3,
      sources: ['src/Tools.tsx'],
      sourcesContent: ['const x = "toolbar-selection";'],
      mappings: 'AAAA',
    }),
    'https://site.test/analytics.js': 'console.log("nothing");\n//# sourceMappingURL=analytics.js.map',
    'https://site.test/analytics.js.map': JSON.stringify({
      version: 3,
      sources: ['src/analytics.ts'],
      sourcesContent: ['console.log("nothing");'],
      mappings: 'AAAA',
    }),
  };
}

function message(over = {}) {
  return {
    action: 'sourceLocate',
    runId: 'r1',
    pageUrl: 'https://site.test/page',
    resources: ['https://site.test/app.js', 'https://site.test/analytics.js'],
    items: [{ id: 'e1', evidence: [{ kind: 'testid', value: 'toolbar-selection' }] }],
    mode: 'element',
    ...over,
  };
}

describe('sw-source-locate', () => {
  beforeEach(() => {
    Sw.__test.reset();
  });

  afterEach(() => {
    global.fetch = REAL_FETCH;
  });

  it('locates evidence and only fetches maps for resources that matched', async () => {
    const files = standardFiles();
    const { fetch, calls } = makeFetch(files);
    global.fetch = fetch;

    const res = await Sw.handleSourceLocateMessage(message(), { tab: { id: 1 } });
    assert.equal(res.ok, true);
    assert.equal(res.results.length, 1);
    assert.deepEqual(
      { id: res.results[0].id, file: res.results[0].file, line: res.results[0].line },
      { id: 'e1', file: 'src/Tools.tsx', line: 1 },
    );
    assert.equal(res.results[0].confidence, 'high');
    assert.ok(calls.includes('https://site.test/app.js.map'));
    assert.ok(!calls.includes('https://site.test/analytics.js.map'));
    assert.ok(!JSON.stringify(res).includes('const x ='));
  });

  it('does not return sourcesContent on any response path', async () => {
    const files = standardFiles();
    global.fetch = makeFetch(files).fetch;
    const res = await Sw.handleSourceLocateMessage(message(), { tab: { id: 1 } });
    assert.ok(!JSON.stringify(res).includes('toolbar-selection'));
  });

  it('blocks page-controlled private URLs without fetching them', async () => {
    const files = {
      ...standardFiles(),
      'http://169.254.169.254/latest/meta-data/': 'secret',
      'https://site.test/app.js': 'var x="toolbar-selection";\n//# sourceMappingURL=http://127.0.0.1/app.js.map',
    };
    const { fetch, calls } = makeFetch(files);
    global.fetch = fetch;
    const res = await Sw.handleSourceLocateMessage(message({
      resources: ['http://169.254.169.254/latest/meta-data/', 'https://site.test/app.js'],
    }), { tab: { id: 1 } });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'no-map');
    assert.ok(!calls.includes('http://169.254.169.254/latest/meta-data/'));
    assert.ok(!calls.includes('http://127.0.0.1/app.js.map'));
  });

  it('cancels an in-flight run by runId', async () => {
    const { fetch } = makeFetch({}, { hang: ['https://site.test/hang.js'] });
    global.fetch = fetch;
    const pending = Sw.handleSourceLocateMessage(message({
      runId: 'r2',
      resources: ['https://site.test/hang.js'],
      timeoutMs: 5000,
    }), { tab: { id: 2 } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const cancelled = await Sw.handleSourceLocateMessage(
      { action: 'sourceLocateCancel', runId: 'r2' },
      { tab: { id: 2 } },
    );
    assert.equal(cancelled.cancelled, true);
    const res = await pending;
    assert.equal(res.ok, false);
    assert.equal(res.error, 'cancelled');
  });

  it('times out a slow run', async () => {
    const { fetch } = makeFetch({}, { hang: ['https://site.test/hang.js'] });
    global.fetch = fetch;
    const res = await Sw.handleSourceLocateMessage(message({
      runId: 'r3',
      resources: ['https://site.test/hang.js'],
      timeoutMs: 100,
    }), { tab: { id: 3 } });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'timeout');
  });

  it('reuses cached results for the same page and evidence', async () => {
    const files = standardFiles();
    const { fetch, calls } = makeFetch(files);
    global.fetch = fetch;
    const first = await Sw.handleSourceLocateMessage(message({ runId: 'r4' }), { tab: { id: 4 } });
    assert.equal(first.ok, true);
    const callCount = calls.length;
    const second = await Sw.handleSourceLocateMessage(message({ runId: 'r5' }), { tab: { id: 4 } });
    assert.equal(second.ok, true);
    assert.equal(second.stats.cacheHit, true);
    assert.equal(calls.length, callCount);
  });

  it('treats sections maps as no map', async () => {
    const files = {
      'https://site.test/app.js': 'var x="toolbar-selection";\n//# sourceMappingURL=app.js.map',
      'https://site.test/app.js.map': JSON.stringify({
        version: 3,
        sections: [{
          offset: { line: 0, column: 0 },
          map: { version: 3, sources: ['src/A.ts'], mappings: 'AAAA' },
        }],
      }),
    };
    global.fetch = makeFetch(files).fetch;
    const res = await Sw.handleSourceLocateMessage(message({
      resources: ['https://site.test/app.js'],
    }), { tab: { id: 5 } });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'no-map');
  });

  it('returns blocked-url when every resource is blocked', async () => {
    const { fetch, calls } = makeFetch({});
    global.fetch = fetch;
    const res = await Sw.handleSourceLocateMessage(message({
      resources: ['http://127.0.0.1/x.js', 'file:///etc/passwd'],
    }), { tab: { id: 6 } });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'blocked-url');
    assert.equal(calls.length, 0);
  });
});

describe('sw-source-locate ambiguity', () => {
  afterEach(() => {
    global.fetch = REAL_FETCH;
  });

  it('does not mark repeated evidence as high confidence', async () => {
    const files = {
      'https://site.test/dup.js': 'var a="toolbar-selection";var b="toolbar-selection";\n//# sourceMappingURL=dup.js.map',
      'https://site.test/dup.js.map': JSON.stringify({
        version: 3,
        sources: ['src/Dup.tsx'],
        sourcesContent: ['const a = "toolbar-selection"; const b = "toolbar-selection";'],
        mappings: 'AAAA',
      }),
    };
    global.fetch = makeFetch(files).fetch;
    const res = await Sw.handleSourceLocateMessage(message({
      runId: 'r7',
      resources: ['https://site.test/dup.js'],
    }), { tab: { id: 7 } });
    assert.equal(res.ok, true);
    assert.notEqual(res.results[0].confidence, 'high');
  });
});
