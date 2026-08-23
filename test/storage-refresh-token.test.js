'use strict';

/**
 * Storage refreshToken 持久化单测（OPT-20260824-052）。
 * 覆盖：登录写入、刷新轮换覆盖、三参调用保留旧值、清 token 连带清空、clearAuth 清空、getApiConfig 读取。
 */

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
  storage: { local: createMemoryArea(), session: createMemoryArea() },
};

const Storage = require('../lib/storage.js');

describe('Storage refreshToken persistence', () => {
  beforeEach(async () => {
    global.chrome.storage.local = createMemoryArea();
    global.chrome.storage.session = createMemoryArea();
    Storage._area = global.chrome.storage.local;
    Storage._session = global.chrome.storage.session;
  });

  it('saveApiConfig with refreshToken persists it; getApiConfig returns it', async () => {
    await Storage.saveApiConfig('https://aidevpush.com', 'tok-1', 3600, 'refresh-abc');
    const cfg = await Storage.getApiConfig();
    assert.equal(cfg.token, 'tok-1');
    assert.equal(cfg.refreshToken, 'refresh-abc');
    assert.ok(cfg.tokenExpiresAt > Math.floor(Date.now() / 1000));
  });

  it('refresh rotation: 4-arg call overwrites refreshToken with rotated value', async () => {
    await Storage.saveApiConfig('https://aidevpush.com', 'tok-1', 3600, 'refresh-abc');
    await Storage.saveApiConfig('https://aidevpush.com', 'tok-2', 3600, 'refresh-rotated');
    const cfg = await Storage.getApiConfig();
    assert.equal(cfg.token, 'tok-2');
    assert.equal(cfg.refreshToken, 'refresh-rotated');
  });

  it('3-arg call (no refreshToken) keeps existing refreshToken (旧调用方兼容)', async () => {
    await Storage.saveApiConfig('https://aidevpush.com', 'tok-1', 3600, 'refresh-abc');
    await Storage.saveApiConfig('https://aidevpush.com', 'tok-1b', 3600);
    const cfg = await Storage.getApiConfig();
    assert.equal(cfg.refreshToken, 'refresh-abc');
  });

  it('clearing token (empty) also clears refreshToken', async () => {
    await Storage.saveApiConfig('https://aidevpush.com', 'tok-1', 3600, 'refresh-abc');
    await Storage.saveApiConfig('https://aidevpush.com', '', 0);
    const cfg = await Storage.getApiConfig();
    assert.equal(cfg.token, '');
    assert.equal(cfg.refreshToken, '');
    assert.equal(cfg.tokenExpiresAt, 0);
  });

  it('clearAuth clears refreshToken along with token', async () => {
    await Storage.saveApiConfig('https://aidevpush.com', 'tok-1', 3600, 'refresh-abc');
    await Storage.clearAuth();
    const cfg = await Storage.getApiConfig();
    assert.equal(cfg.token, '');
    assert.equal(cfg.refreshToken, '');
  });

  it('getApiConfig defaults refreshToken to empty string when absent', async () => {
    await Storage.set({ token: 'tok-1' });
    const cfg = await Storage.getApiConfig();
    assert.equal(cfg.refreshToken, '');
  });
});
