'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const C = require('../lib/source-locate-client.js');

function fakeDoc() {
  return {
    baseURI: 'https://site.test/app/',
    querySelectorAll(selector) {
      if (selector === 'script[src]') {
        return [
          { src: 'https://site.test/app.js' },
          { src: '/vendor.js' },
          { src: 'https://site.test/app.js' },
        ];
      }
      if (selector.indexOf('link') === 0) {
        return [
          { href: 'https://cdn.test/app.css' },
          { href: 'blob:https://site.test/x' },
        ];
      }
      return [];
    },
  };
}

const fakePerf = {
  getEntriesByType(type) {
    assert.equal(type, 'resource');
    return [
      { name: 'https://site.test/chunk.js', initiatorType: 'script' },
      { name: 'https://site.test/cover.png', initiatorType: 'img' },
    ];
  },
};

describe('source-locate-client resources', () => {
  it('collects scripts, modulepreloads/styles and performance entries in order', () => {
    const urls = C.collectResourceUrls(fakeDoc(), fakePerf);
    assert.deepEqual(urls, [
      'https://site.test/app.js',
      'https://site.test/vendor.js',
      'https://cdn.test/app.css',
      'https://site.test/chunk.js',
    ]);
  });

  it('caps resources at 24', () => {
    const many = {
      baseURI: 'https://site.test/',
      querySelectorAll() {
        return Array.from({ length: 40 }, (_, i) => ({ src: `https://site.test/${i}.js` }));
      },
    };
    assert.equal(C.collectResourceUrls(many, null).length, 24);
  });

  it('builds stable run ids', () => {
    const a = C.makeRunId('adj');
    const b = C.makeRunId('adj');
    assert.match(a, /^sl-adj-[a-z0-9]+-[a-z0-9]+$/);
    assert.notEqual(a, b);
  });
});

describe('source-locate-client requests', () => {
  it('locates evidence batches by index id', async () => {
    const sent = [];
    const res = await C.locateEvidence(
      [[{ kind: 'testid', value: 'x' }], []],
      {
        pageUrl: 'https://site.test/',
        collectResources: () => ['https://site.test/app.js'],
        sendMessage: async (msg) => {
          sent.push(msg);
          return { ok: true, results: [{ id: 'e0', file: 'src/A.vue', line: 1, confidence: 'high' }] };
        },
      },
      'sl-adj-1',
    );
    assert.equal(res.ok, true);
    assert.equal(sent[0].action, 'sourceLocate');
    assert.equal(sent[0].items.length, 1);
    assert.equal(sent[0].items[0].id, 'e0');
    assert.equal(sent[0].mode, 'element');
  });

  it('sends a cancel message when the request throws', async () => {
    const sent = [];
    const res = await C.request({
      pageUrl: 'https://site.test/',
      resources: ['https://site.test/app.js'],
      items: [{ id: 'e0', evidence: [{ kind: 'testid', value: 'x' }] }],
      mode: 'element',
    }, {
      sendMessage: async (msg) => {
        sent.push(msg);
        if (msg.action === 'sourceLocate') throw new Error('timeout');
        return { ok: true };
      },
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'timeout');
    assert.equal(sent[1].action, 'sourceLocateCancel');
  });
});

describe('source-locate-client advisor enrichment', () => {
  function deps(results) {
    return {
      pageUrl: 'https://site.test/',
      collectResources: () => ['https://site.test/app.js'],
      evidenceFromSuggestion: (s) => (s.testid ? [{ kind: 'testid', value: s.testid }] : []),
      sendMessage: async (msg) => {
        assert.equal(msg.action, 'sourceLocate');
        assert.equal(msg.mode, 'advisor');
        return { ok: true, results };
      },
    };
  }

  it('attaches only high/medium results without mutating the originals', async () => {
    const input = [
      { id: 's1', testid: 'a' },
      { id: 's2', testid: 'b' },
    ];
    const out = await C.enrichSuggestions(input, deps([
      { id: 's1', file: 'src/A.vue', line: 1, confidence: 'high' },
      { id: 's2', file: 'src/B.vue', line: 2, confidence: 'low' },
    ]));
    assert.equal(out[0].source_file, 'src/A.vue');
    assert.equal(out[0].source_line, 1);
    assert.equal(out[0].source_confidence, 'high');
    assert.equal(out[1].source_file, undefined);
    assert.equal(input[0].source_file, undefined);
  });

  it('returns the original list when the request fails', async () => {
    const input = [{ id: 's1', testid: 'a' }];
    const out = await C.enrichSuggestions(input, {
      pageUrl: 'https://site.test/',
      collectResources: () => [],
      evidenceFromSuggestion: (s) => [{ kind: 'testid', value: s.testid }],
      sendMessage: async () => ({ ok: false, error: 'timeout' }),
    });
    assert.equal(out, input);
  });

  it('returns the original list when no suggestion has evidence', async () => {
    const input = [{ id: 's1' }];
    const out = await C.enrichSuggestions(input, {
      pageUrl: 'https://site.test/',
      collectResources: () => [],
      evidenceFromSuggestion: () => [],
      sendMessage: async () => { throw new Error('should not be called'); },
    });
    assert.equal(out, input);
  });
});

describe('source-locate-client advisor toggle', () => {
  it('persists the boolean in storage', async () => {
    let stored = {};
    const d = {
      storageGet: async () => stored,
      storageSet: async (obj) => { stored = { ...stored, ...obj }; },
    };
    assert.equal(await C.isAdvisorEnabled(d), false);
    await C.setAdvisorEnabled(true, d);
    assert.equal(await C.isAdvisorEnabled(d), true);
  });
});

describe('source-locate-client advisor batch cap', () => {
  it('sends at most 20 suggestions', async () => {
    const input = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, testid: `t${i}` }));
    let sent = null;
    const out = await C.enrichSuggestions(input, {
      pageUrl: 'https://site.test/',
      collectResources: () => [],
      evidenceFromSuggestion: (s) => [{ kind: 'testid', value: s.testid }],
      sendMessage: async (msg) => {
        sent = msg;
        return { ok: true, results: [] };
      },
    });
    assert.equal(sent.items.length, 20);
    assert.equal(out.length, 25);
  });
});
