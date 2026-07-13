'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

function createMemoryArea() {
  const data = {};
  return {
    _data: data,
    async get(keys) {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) {
        if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
      }
      return out;
    },
    async set(obj) {
      Object.assign(data, obj);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete data[k];
    },
  };
}

global.chrome = {
  storage: {
    local: createMemoryArea(),
    session: createMemoryArea(),
  },
};

const Storage = require('../lib/storage.js');

describe('Storage baseUrl persistence', () => {
  beforeEach(async () => {
    global.chrome.storage.local = createMemoryArea();
    global.chrome.storage.session = createMemoryArea();
    Storage._area = global.chrome.storage.local;
    Storage._session = global.chrome.storage.session;
  });

  it('getApiConfig returns default when no baseUrl saved', async () => {
    const cfg = await Storage.getApiConfig();
    assert.equal(cfg.baseUrl, 'http://183.250.1.132:18081');
  });

  it('saveBaseUrl persists custom address across getApiConfig', async () => {
    await Storage.saveBaseUrl('http://127.0.0.1:18081/');
    const cfg = await Storage.getApiConfig();
    assert.equal(cfg.baseUrl, 'http://127.0.0.1:18081');
  });

  it('clearAuth clears token but keeps baseUrl', async () => {
    await Storage.saveApiConfig('http://custom.example:9999', 'tok-1', 3600);
    await Storage.saveCredentials('alice', 'u1', 'm1');

    await Storage.clearAuth();

    const cfg = await Storage.getApiConfig();
    const cred = await Storage.getCredentials();
    assert.equal(cfg.baseUrl, 'http://custom.example:9999');
    assert.equal(cfg.token, '');
    assert.equal(cfg.tokenExpiresAt, 0);
    assert.equal(cred.username, '');
    assert.equal(cred.userId, '');
  });

  it('saveApiConfig with empty baseUrl does not wipe remembered address', async () => {
    await Storage.saveBaseUrl('http://remember.me:18081');
    await Storage.saveApiConfig('', '');

    const cfg = await Storage.getApiConfig();
    assert.equal(cfg.baseUrl, 'http://remember.me:18081');
    assert.equal(cfg.token, '');
  });

  it('saveApiConfig with non-empty baseUrl updates address', async () => {
    await Storage.saveBaseUrl('http://old.example:1');
    await Storage.saveApiConfig('http://new.example:2/', 'tok');

    const cfg = await Storage.getApiConfig();
    assert.equal(cfg.baseUrl, 'http://new.example:2');
    assert.equal(cfg.token, 'tok');
  });
});
