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
    assert.equal(cfg.baseUrl, 'https://daydaymoney.com');
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

  it('saveApiConfig without expiresIn clears stale expired tokenExpiresAt', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    await Storage.set({
      baseUrl: 'http://gw.example',
      token: 'old-tok',
      tokenExpiresAt: past,
      tokenIssuedAt: past - 7200,
    });

    await Storage.saveApiConfig('http://gw.example', 'new-tok');

    const cfg = await Storage.getApiConfig();
    assert.equal(cfg.token, 'new-tok');
    assert.equal(cfg.tokenExpiresAt, 0);
    assert.equal(await Storage.isTokenExpired(), false);
  });

  it('saveApiConfig without expiresIn keeps still-valid tokenExpiresAt', async () => {
    const future = Math.floor(Date.now() / 1000) + 7200;
    await Storage.set({
      baseUrl: 'http://gw.example',
      token: 'old-tok',
      tokenExpiresAt: future,
      tokenIssuedAt: future - 3600,
    });

    await Storage.saveApiConfig('http://gw.example', 'new-tok');

    const cfg = await Storage.getApiConfig();
    assert.equal(cfg.token, 'new-tok');
    assert.equal(cfg.tokenExpiresAt, future);
    assert.equal(await Storage.isTokenExpired(), false);
  });

  it('migrateStaleTokenExpiryOnce clears expired expiry once', async () => {
    const past = Math.floor(Date.now() / 1000) - 120;
    await Storage.set({
      token: 'tok',
      tokenExpiresAt: past,
      tokenIssuedAt: past - 100,
    });

    assert.equal(await Storage.isTokenExpired(), true);
    const cleared = await Storage.migrateStaleTokenExpiryOnce();
    assert.equal(cleared, true);
    assert.equal(await Storage.isTokenExpired(), false);

    // second call is no-op even if we set expired again before flag
    await Storage.set({ tokenExpiresAt: past });
    const clearedAgain = await Storage.migrateStaleTokenExpiryOnce();
    assert.equal(clearedAgain, false);
  });

  it('formatTokenExpiryHint returns null when far from expiry or unknown', () => {
    assert.equal(Storage.formatTokenExpiryHint(Infinity), null);
    assert.equal(Storage.formatTokenExpiryHint(-1), null);
    assert.equal(Storage.formatTokenExpiryHint(0), null);
    assert.equal(Storage.formatTokenExpiryHint(20 * 60), null);
  });

  it('formatTokenExpiryHint warns under 15 minutes and critical under 5', () => {
    const warn = Storage.formatTokenExpiryHint(10 * 60);
    assert.equal(warn.level, 'warn');
    assert.match(warn.text, /10分钟后过期/);

    const critical = Storage.formatTokenExpiryHint(90);
    assert.equal(critical.level, 'critical');
    assert.match(critical.text, /2分钟后过期/);
  });
});
