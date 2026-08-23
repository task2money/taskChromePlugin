'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  decodeWebRequestBody,
  createRequestBodyCache,
  normalizeUrlForBodyMatch,
} = require('../lib/request-body-cache.js');

describe('decodeWebRequestBody', () => {
  it('decodes raw bytes as UTF-8 JSON', () => {
    const json = '{"hello":"世界"}';
    const bytes = new TextEncoder().encode(json);
    const text = decodeWebRequestBody({ raw: [{ bytes }] });
    assert.equal(text, json);
  });

  it('decodes formData into a query string', () => {
    const text = decodeWebRequestBody({
      formData: { user: ['ada'], tags: ['a', 'b'] },
    });
    assert.equal(text, 'user=ada&tags=a&tags=b');
  });

  it('returns empty string when body is missing', () => {
    assert.equal(decodeWebRequestBody(undefined), '');
    assert.equal(decodeWebRequestBody({ error: 'unknown' }), '');
  });
});

describe('request body cache matching', () => {
  it('matches by method + url + tabId within the time window', () => {
    const cache = createRequestBodyCache({ ttlMs: 60_000, maxEntries: 20 });
    const t0 = 1_700_000_000_000;
    cache.put({
      method: 'POST',
      url: 'https://api.example.com/orders#frag',
      tabId: 3,
      timeStamp: t0,
      body: '{"ok":1}',
    });
    const found = cache.lookup({
      method: 'POST',
      url: 'https://api.example.com/orders',
      tabId: 3,
      timestamp: t0 + 400,
    });
    assert.equal(found, '{"ok":1}');
  });

  it('does not match a different method or expired entry', () => {
    const cache = createRequestBodyCache({ ttlMs: 1_000, maxEntries: 20 });
    cache.put({
      method: 'POST',
      url: 'https://api.example.com/orders',
      tabId: 3,
      timeStamp: 1000,
      body: '{"ok":1}',
    });
    assert.equal(
      cache.lookup({
        method: 'GET',
        url: 'https://api.example.com/orders',
        tabId: 3,
        timestamp: 1100,
      }),
      '',
    );
    assert.equal(
      cache.lookup({
        method: 'POST',
        url: 'https://api.example.com/orders',
        tabId: 3,
        timestamp: 1000 + 5_000,
      }),
      '',
    );
  });

  it('prefers exact requestId over time window for parallel same-URL POSTs', () => {
    const cache = createRequestBodyCache({ ttlMs: 60_000, maxEntries: 20 });
    const t0 = 1_700_000_000_000;
    // 同标签页 100ms 内两条同 URL POST，body 不同 —— 时间窗会配错，requestId 必须精确
    cache.put({
      method: 'POST',
      url: 'https://api.example.com/orders',
      tabId: 3,
      timeStamp: t0,
      requestId: 'req-10001',
      body: '{"sku":"a"}',
    });
    cache.put({
      method: 'POST',
      url: 'https://api.example.com/orders',
      tabId: 3,
      timeStamp: t0 + 80,
      requestId: 'req-10002',
      body: '{"sku":"b"}',
    });

    assert.equal(
      cache.lookup({
        method: 'POST',
        url: 'https://api.example.com/orders',
        tabId: 3,
        timestamp: t0 + 90,
        requestId: 'req-10002',
      }),
      '{"sku":"b"}',
    );
    assert.equal(
      cache.lookup({
        method: 'POST',
        url: 'https://api.example.com/orders',
        tabId: 3,
        timestamp: t0 + 10,
        requestId: 'req-10001',
      }),
      '{"sku":"a"}',
    );
  });

  it('falls back to time window when requestId is unknown', () => {
    const cache = createRequestBodyCache({ ttlMs: 60_000, maxEntries: 20 });
    const t0 = 1_700_000_000_000;
    cache.put({
      method: 'POST',
      url: 'https://api.example.com/orders',
      tabId: 3,
      timeStamp: t0,
      requestId: 'req-10001',
      body: '{"sku":"a"}',
    });
    // 查询方带了一个缓存里没有的 requestId —— 不应命中错误 body，回退时间窗命中最近的
    assert.equal(
      cache.lookup({
        method: 'POST',
        url: 'https://api.example.com/orders',
        tabId: 3,
        timestamp: t0 + 5,
        requestId: 'req-99999',
      }),
      '{"sku":"a"}',
    );
  });
});

describe('normalizeUrlForBodyMatch', () => {
  it('strips hash fragments', () => {
    assert.equal(
      normalizeUrlForBodyMatch('https://a.example/x#y'),
      'https://a.example/x',
    );
  });
});
