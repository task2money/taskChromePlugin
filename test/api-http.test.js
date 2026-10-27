'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const APIHttp = require('../lib/api-http.js');

describe('pluginIdentityHeaders 插件版本遥测头', () => {
  let origFetch;
  let origChrome;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    origChrome = globalThis.chrome;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    globalThis.chrome = origChrome;
  });

  it('从 chrome.runtime.getManifest 读取运行期版本', () => {
    const fakeChrome = { runtime: { getManifest: () => ({ version: '1.8.282' }) } };
    assert.deepEqual(APIHttp.pluginIdentityHeaders(fakeChrome), {
      'X-Plugin-Key': 'chrome_extension',
      'X-Plugin-Version': '1.8.282',
    });
  });

  it('无 chrome 环境（Node 单测）不发身份头', () => {
    delete globalThis.chrome;
    assert.deepEqual(APIHttp.pluginIdentityHeaders(), {});
  });

  it('request 携带 X-Plugin-Key / X-Plugin-Version', async () => {
    globalThis.chrome = { runtime: { getManifest: () => ({ version: '1.8.282' }) } };
    let seen;
    globalThis.fetch = async (_url, opts) => {
      seen = opts;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    await APIHttp.request({ baseUrl: 'https://example.test', token: '' }, 'GET', '/api/x');
    assert.equal(seen.headers['X-Plugin-Key'], 'chrome_extension');
    assert.equal(seen.headers['X-Plugin-Version'], '1.8.282');
  });

  it('requestUnauthenticated 携带身份头但不带 Authorization', async () => {
    globalThis.chrome = { runtime: { getManifest: () => ({ version: '1.8.282' }) } };
    let seen;
    globalThis.fetch = async (_url, opts) => {
      seen = opts;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    await APIHttp.requestUnauthenticated(
      { baseUrl: 'https://example.test' }, 'POST', '/api/login', { a: 1 },
    );
    assert.equal(seen.headers['X-Plugin-Version'], '1.8.282');
    assert.equal(seen.headers.Authorization, undefined);
  });
});

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
