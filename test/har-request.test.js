'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const HarRequest = require('../lib/har-request.js');

const {
  headersToObject,
  isCanceledHarEntry,
  harEntryKey,
  buildRequestFromHarEntry,
  mergeHarEntries,
  trimRequestBuffer,
  shouldEnrichHarBody,
} = HarRequest;

describe('headersToObject', () => {
  it('returns empty object for non-array', () => {
    assert.deepEqual(headersToObject(undefined), {});
    assert.deepEqual(headersToObject(null), {});
  });

  it('maps header name/value pairs', () => {
    assert.deepEqual(
      headersToObject([{ name: 'Content-Type', value: 'application/json' }]),
      { 'Content-Type': 'application/json' }
    );
  });
});

describe('isCanceledHarEntry', () => {
  it('detects status 0 without response object', () => {
    assert.equal(isCanceledHarEntry({ request: { url: 'http://x' } }), true);
  });

  it('detects missing response entirely', () => {
    assert.equal(isCanceledHarEntry({ request: { method: 'GET', url: 'http://x' } }), true);
  });

  it('detects ERR_ABORTED via _errorText', () => {
    assert.equal(
      isCanceledHarEntry({
        request: { method: 'GET', url: 'http://x' },
        response: { status: 200 },
        _errorText: 'net::ERR_ABORTED',
      }),
      true
    );
  });

  it('returns false for normal 200 response', () => {
    assert.equal(
      isCanceledHarEntry({
        request: { method: 'GET', url: 'http://x' },
        response: { status: 200, statusText: 'OK', headers: [] },
      }),
      false
    );
  });
});

describe('buildRequestFromHarEntry', () => {
  const makeId = () => 'test-id-fixed';

  it('handles canceled entry with no response object', () => {
    const req = buildRequestFromHarEntry(
      {
        startedDateTime: '2026-07-05T10:00:00.000Z',
        request: { method: 'GET', url: 'http://example.com/api', headers: [] },
        time: 12.5,
        _resourceType: 'fetch',
      },
      { makeId }
    );

    assert.equal(req.id, 'test-id-fixed');
    assert.equal(req.statusCode, 0);
    assert.equal(req.statusText, 'Canceled');
    assert.equal(req.canceled, true);
    assert.equal(req.error, 'net::ERR_ABORTED');
    assert.equal(req.method, 'GET');
    assert.equal(req.url, 'http://example.com/api');
    assert.deepEqual(req.requestHeaders, {});
    assert.deepEqual(req.responseHeaders, {});
    assert.equal(req.timestamp, Date.parse('2026-07-05T10:00:00.000Z'));
  });

  it('handles successful response with headers', () => {
    const req = buildRequestFromHarEntry(
      {
        startedDateTime: '2026-07-05T10:01:00.000Z',
        request: {
          method: 'POST',
          url: 'http://example.com/create',
          headers: [{ name: 'Accept', value: 'application/json' }],
          postData: { text: '{"a":1}' },
        },
        response: {
          status: 201,
          statusText: 'Created',
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          content: { mimeType: 'application/json', text: '{"ok":true}' },
        },
        time: 88,
      },
      { makeId }
    );

    assert.equal(req.statusCode, 201);
    assert.equal(req.canceled, false);
    assert.equal(req.requestBody, '{"a":1}');
    assert.equal(req.responseBody, '{"ok":true}');
    assert.deepEqual(req.requestHeaders, { Accept: 'application/json' });
    assert.deepEqual(req.responseHeaders, { 'Content-Type': 'application/json' });
  });

  it('parses postData when it is a raw string', () => {
    const req = buildRequestFromHarEntry(
      {
        request: {
          method: 'POST',
          url: 'http://example.com/x',
          postData: '{"raw":true}',
        },
        response: { status: 200, statusText: 'OK', headers: [] },
      },
      { makeId }
    );
    assert.equal(req.requestBody, '{"raw":true}');
  });

  it('serializes postData.params when text is missing', () => {
    const req = buildRequestFromHarEntry(
      {
        request: {
          method: 'POST',
          url: 'http://example.com/form',
          postData: { params: [{ name: 'q', value: '1' }, { name: 'p', value: '2' }] },
        },
        response: { status: 200, statusText: 'OK', headers: [] },
      },
      { makeId }
    );
    assert.equal(req.requestBody, 'q=1&p=2');
  });

  it('does not throw when response.headers is undefined', () => {
    assert.doesNotThrow(() => {
      buildRequestFromHarEntry(
        {
          request: { method: 'GET', url: 'http://example.com/x' },
          response: { status: 0 },
        },
        { makeId }
      );
    });
  });
});

describe('mergeHarEntries', () => {
  it('deduplicates by harKey when caller tracks seen keys', () => {
    const seen = new Set();
    const entry = {
      startedDateTime: '2026-07-05T10:00:00.000Z',
      request: { method: 'GET', url: 'http://example.com/a', headers: [] },
    };
    const first = mergeHarEntries([entry], seen, { makeId: () => 'id-1' });
    seen.add(first.added[0].harKey);
    const second = mergeHarEntries([entry], seen, { makeId: () => 'id-2' });

    assert.equal(first.added.length, 1);
    assert.equal(first.skipped, 0);
    assert.equal(second.added.length, 0);
    assert.equal(second.skipped, 1);
  });

  it('adds multiple distinct entries', () => {
    const seen = new Set();
    const { added } = mergeHarEntries(
      [
        {
          startedDateTime: '2026-07-05T10:00:00.000Z',
          request: { method: 'GET', url: 'http://example.com/a', headers: [] },
        },
        {
          startedDateTime: '2026-07-05T10:00:01.000Z',
          request: { method: 'GET', url: 'http://example.com/b', headers: [] },
        },
      ],
      seen,
      { makeId: () => 'id-x' }
    );
    assert.equal(added.length, 2);
    assert.equal(added[0].harKey, '2026-07-05T10:00:00.000Z\x00GET\x00http://example.com/a');
    assert.equal(added[1].harKey, '2026-07-05T10:00:01.000Z\x00GET\x00http://example.com/b');
  });
});

describe('trimRequestBuffer', () => {
  it('keeps newest entries by timestamp', () => {
    const trimmed = trimRequestBuffer(
      [
        { timestamp: 1, id: 'a' },
        { timestamp: 3, id: 'c' },
        { timestamp: 2, id: 'b' },
      ],
      2
    );
    assert.equal(trimmed.length, 2);
    assert.deepEqual(trimmed.map((r) => r.id), ['b', 'c']);
  });
});

describe('shouldEnrichHarBody', () => {
  it('returns false when body already present', () => {
    assert.equal(
      shouldEnrichHarBody({ responseBody: 'ok', statusCode: 500 }, { getContent: () => {} }),
      false
    );
  });

  it('returns false when entry has no getContent function', () => {
    assert.equal(
      shouldEnrichHarBody({ method: 'GET', statusCode: 200 }, {}),
      false
    );
  });

  it('returns true for any request with getContent and empty body', () => {
    assert.equal(
      shouldEnrichHarBody({ statusCode: 200, method: 'GET' }, { getContent: () => {} }),
      true
    );
  });

  it('returns true for 4xx/5xx without body', () => {
    assert.equal(
      shouldEnrichHarBody({ statusCode: 404 }, { getContent: () => {} }),
      true
    );
  });

  it('returns true for canceled requests when getContent exists', () => {
    assert.equal(
      shouldEnrichHarBody({ canceled: true, statusCode: 0 }, { getContent: () => {} }),
      true
    );
  });

  it('returns true for POST without body', () => {
    assert.equal(
      shouldEnrichHarBody({ method: 'POST', statusCode: 201 }, { getContent: () => {} }),
      true
    );
  });
});

describe('filterBackfillCandidates', () => {
  it('keeps candidates inside the window', () => {
    const now = Date.now();
    const req = { harKey: 'k1', timestamp: now - 60 * 1000 };
    const kept = HarRequest.filterBackfillCandidates([req], { cutoffMs: now - 5 * 60 * 1000 });
    assert.deepEqual(kept, [req]);
  });

  it('skips candidates older than the window (cleaned by the 30s sweep)', () => {
    const now = Date.now();
    const old = { harKey: 'k1', timestamp: now - 6 * 60 * 1000 };
    const fresh = { harKey: 'k2', timestamp: now - 1000 };
    const kept = HarRequest.filterBackfillCandidates([old, fresh], { cutoffMs: now - 5 * 60 * 1000 });
    assert.deepEqual(kept, [fresh]);
  });

  it('skips candidates whose harKey is already in the buffer', () => {
    const now = Date.now();
    const dup = { harKey: 'k1', timestamp: now - 1000 };
    const known = new Set(['k1', 'k2']);
    const kept = HarRequest.filterBackfillCandidates([dup, { harKey: 'k3', timestamp: now - 1000 }], {
      cutoffMs: now - 5 * 60 * 1000,
      knownKeys: known,
    });
    assert.equal(kept.length, 1);
    assert.equal(kept[0].harKey, 'k3');
  });

  it('is a no-op filter when options are absent', () => {
    const reqs = [{ harKey: 'k1', timestamp: 1 }, { harKey: 'k2', timestamp: 2 }];
    const kept = HarRequest.filterBackfillCandidates(reqs);
    assert.deepEqual(kept, reqs);
  });

  it('handles non-array input', () => {
    assert.deepEqual(HarRequest.filterBackfillCandidates(undefined, {}), []);
    assert.deepEqual(HarRequest.filterBackfillCandidates(null, {}), []);
  });

  it('keeps requests with unknown timestamp (parse fallback)', () => {
    const req = { harKey: 'k1', timestamp: 0 };
    const kept = HarRequest.filterBackfillCandidates([req], { cutoffMs: Date.now() });
    assert.deepEqual(kept, [req]);
  });
});
