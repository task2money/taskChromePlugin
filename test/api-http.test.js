'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const APIHttp = require('../lib/api-http.js');

describe('fetchWithClientTrace omits website cookies', () => {
  let origFetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('defaults credentials to omit so aidevpush.com Cookie token cannot override Bearer', async () => {
    let seen;
    globalThis.fetch = async (_url, opts) => {
      seen = opts;
      return { ok: true, status: 200 };
    };
    await APIHttp.fetchWithClientTrace('https://www.aidevpush.com/api/x', { method: 'GET' }, 'tr-1');
    assert.equal(seen.credentials, 'omit');
  });
});
