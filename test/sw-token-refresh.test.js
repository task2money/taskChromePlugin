'use strict';

/**
 * SW 静默刷新集成单测（OPT-20260824-052）。
 *
 * 通过 vm 沙箱执行真实 service-worker.js（拼接 lib），驱动 runtime.onMessage
 * 监听器，验证：
 * 1. access token 过期 + 持 refresh token → getAuthStatus 自动静默刷新，返回未过期状态
 * 2. 未过期 → 不发起刷新请求
 * 3. 过期但无 refresh token（旧版登录态）→ 不刷新，保持过期（向后兼容）
 * 4. 并发触发（popup/panel/badge 轮询）→ 单飞锁：仅一次刷新请求
 * 5. 刷新失败（invalid_grant / 网络）→ 保留现状不崩溃，UI 走「重新登录」兜底
 * 6. oauthRefresh 显式刷新消息
 * 7. getAuthStatus 响应绝不泄漏 refreshToken（安全边界）
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const SW_PATH = path.join(__dirname, '../background/service-worker.js');
const LIB_DIR = path.join(__dirname, '../lib');

function buildSWScript() {
  const swSrc = fs.readFileSync(SW_PATH, 'utf8');
  const libs = [];
  const swBody = swSrc.replace(/importScripts\(([\s\S]*?)\);/, (_, args) => {
    for (const p of args.match(/'[^']+'/g) || []) {
      const file = p.replace(/'/g, '').replace('../lib/', '');
      libs.push(fs.readFileSync(path.join(LIB_DIR, file), 'utf8'));
    }
    return '';
  });
  return libs.join('\n') + '\n' + swBody;
}

/** 内存版 chrome.storage（可预置数据，get 返回快照） */
function createMemoryArea(seed = {}) {
  const data = { ...seed };
  return {
    _data: data,
    async get(keys) {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
      return out;
    },
    async set(obj) { Object.assign(data, obj); },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete data[k];
    },
  };
}

const listenerAdder = () => ({ addListener: () => {} });

/** 加载真实 SW：返回 { send, storageLocal, refreshCalls, fetchImpl } */
function loadSW({ storageSeed, fetchImpl }) {
  const storageLocal = createMemoryArea(storageSeed);
  const refreshCalls = [];
  const onMessageCapture = {};
  const chrome = {
    alarms: { get: (n, cb) => cb(null), create: () => {}, onAlarm: { addListener: () => {} } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    webRequest: { onCompleted: listenerAdder(), onErrorOccurred: listenerAdder() },
    storage: { local: storageLocal, session: createMemoryArea(), onChanged: { addListener: () => {} } },
    tabs: {
      onActivated: listenerAdder(), onRemoved: listenerAdder(), onDiscarded: listenerAdder(), onUpdated: listenerAdder(),
      query: async () => [], sendMessage: async () => ({}), create: async () => ({}), remove: async () => ({}),
    },
    runtime: {
      onMessage: { addListener: (fn) => { onMessageCapture.listener = fn; } },
      onInstalled: listenerAdder(),
      id: 'test-ext-id',
    },
    commands: { onCommand: listenerAdder() },
    windows: { create: async () => ({}) },
  };

  const sandbox = {
    chrome,
    console: {
      log: () => {}, warn: () => {}, error: () => {},
      info: () => {}, debug: () => {},
    },
    fetch: async (url, opts) => {
      const body = opts ? JSON.parse(opts.body) : {};
      if (body.grant_type === 'refresh_token') {
        refreshCalls.push({ url, body });
        return fetchImpl(url, opts, body);
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    },
    setTimeout, clearTimeout,
    URL, URLSearchParams, Map, Set, Promise, AbortController, AbortSignal,
    TextEncoder,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildSWScript(), sandbox, { filename: 'service-worker.js' });

  /** 发送消息到 SW 并等待 sendResponse */
  function send(msg) {
    return new Promise((resolve, reject) => {
      if (!onMessageCapture.listener) return reject(new Error('onMessage listener not registered'));
      onMessageCapture.listener(msg, { tab: { id: 1 } }, (resp) => resolve(resp));
    });
  }
  return { send, storageLocal, refreshCalls, sandbox };
}

const EXPIRED_AT = Math.floor(Date.now() / 1000) - 3600; // 1 小时前过期
const FUTURE_AT = Math.floor(Date.now() / 1000) + 3500;

function expiredSeed() {
  return {
    baseUrl: 'https://aidevpush.com',
    token: 'tok-expired',
    tokenIssuedAt: EXPIRED_AT - 3600,
    tokenExpiresAt: EXPIRED_AT,
    refreshToken: 'refresh-orig',
    authExpiryMigratedV161: true,
  };
}

describe('SW OAuth access token 静默续期', () => {
  beforeEach(() => { /* 每用例独立 loadSW */ });

  it('getAuthStatus：过期 + 持 refresh token → 静默刷新并返回未过期状态', async () => {
    const { send, storageLocal, refreshCalls } = loadSW({
      storageSeed: expiredSeed(),
      fetchImpl: async () => ({
        ok: true, status: 200,
        async json() { return { access_token: 'tok-new', refresh_token: 'refresh-rotated', expires_in: 3600, token_type: 'Bearer' }; },
        async text() { return JSON.stringify({ access_token: 'tok-new', refresh_token: 'refresh-rotated', expires_in: 3600 }); },
      }),
    });

    const resp = await send({ action: 'getAuthStatus' });
    assert.equal(resp.success, true);
    assert.equal(resp.data.expired, false, '刷新后不得再标记过期');
    assert.equal(resp.data.loggedIn, true);
    assert.equal(resp.data.token, 'tok-new');
    assert.equal(resp.data.baseUrl, 'https://aidevpush.com');

    // storage 已写回新 token + 轮换后的 refresh token
    assert.equal(storageLocal._data.token, 'tok-new');
    assert.equal(storageLocal._data.refreshToken, 'refresh-rotated');
    assert.equal(refreshCalls.length, 1);
    const call = refreshCalls[0];
    assert.equal(call.url, 'https://aidevpush.com/api/oidc/token');
    assert.deepEqual(call.body, {
      client_id: 'chrome-extension',
      client_secret: 'chrome-extension-dev-secret',
      grant_type: 'refresh_token',
      refresh_token: 'refresh-orig',
    });
  });

  it('getAuthStatus：未过期 → 不发起刷新请求', async () => {
    const { send, refreshCalls } = loadSW({
      storageSeed: {
        baseUrl: 'https://aidevpush.com', token: 'tok-ok',
        tokenIssuedAt: FUTURE_AT - 3600, tokenExpiresAt: FUTURE_AT,
        refreshToken: 'refresh-orig', authExpiryMigratedV161: true,
      },
      fetchImpl: async () => { throw new Error('should not be called'); },
    });

    const resp = await send({ action: 'getAuthStatus' });
    assert.equal(resp.data.expired, false);
    assert.equal(refreshCalls.length, 0);
  });

  it('getAuthStatus：过期但无 refresh token（旧版登录态）→ 不刷新，保持过期（向后兼容）', async () => {
    const { send, refreshCalls } = loadSW({
      storageSeed: {
        baseUrl: 'https://aidevpush.com', token: 'tok-expired',
        tokenIssuedAt: EXPIRED_AT - 3600, tokenExpiresAt: EXPIRED_AT,
        authExpiryMigratedV161: true,
      },
      fetchImpl: async () => { throw new Error('should not be called'); },
    });

    const resp = await send({ action: 'getAuthStatus' });
    assert.equal(resp.data.expired, true, '无 refresh token 时不得静默刷新');
    assert.equal(refreshCalls.length, 0);
  });

  it('并发触发（popup/panel/badge）→ 单飞锁只发一次刷新请求', async () => {
    let resolved = false;
    const { send, refreshCalls } = loadSW({
      storageSeed: expiredSeed(),
      fetchImpl: async () => {
        await new Promise((r) => setTimeout(r, 30)); // 模拟慢网络
        resolved = true;
        return {
          ok: true, status: 200,
          async json() { return { access_token: 'tok-new', refresh_token: 'refresh-rotated', expires_in: 3600 }; },
          async text() { return JSON.stringify({ access_token: 'tok-new', refresh_token: 'refresh-rotated', expires_in: 3600 }); },
        };
      },
    });

    const [r1, r2, r3] = await Promise.all([
      send({ action: 'getAuthStatus' }),
      send({ action: 'getAuthStatus' }),
      send({ action: 'checkTokenStatus' }),
    ]);
    assert.equal(refreshCalls.length, 1, `单飞锁应合并并发刷新，实际 ${refreshCalls.length} 次`);
    assert.equal(r1.data.expired, false);
    assert.equal(r2.data.expired, false);
    assert.equal(r3.data.expired, false);
    assert.equal(resolved, true);
  });

  it('刷新失败（invalid_grant）→ 清空失效 refresh token，UI 走「重新登录」兜底', async () => {
    const { send, storageLocal, refreshCalls } = loadSW({
      storageSeed: expiredSeed(),
      fetchImpl: async () => ({
        ok: false, status: 400,
        async json() { return { error: 'invalid_grant', error_description: 'invalid or expired refresh token' }; },
        async text() { return JSON.stringify({ error: 'invalid_grant', error_description: 'invalid or expired refresh token' }); },
      }),
    });

    const resp = await send({ action: 'getAuthStatus' });
    assert.equal(resp.success, true);
    assert.equal(resp.data.loggedIn, false, '服务端拒绝后不得再显示已登录');
    assert.equal(refreshCalls.length, 1);
    // invalid_grant → 服务端明确拒绝（已轮换/撤销/过期）：清空 token + refreshToken，防无效重试循环
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(storageLocal._data.token, '');
    assert.equal(storageLocal._data.refreshToken, '');
  });

  it('刷新网络异常 → 保留 refresh token 与旧 token，保持过期状态（瞬时故障可恢复）', async () => {
    const { send, storageLocal } = loadSW({
      storageSeed: expiredSeed(),
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
    const resp = await send({ action: 'getAuthStatus' });
    assert.equal(resp.success, true);
    assert.equal(resp.data.expired, true);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(storageLocal._data.token, 'tok-expired', '网络错误不得清空 token');
    assert.equal(storageLocal._data.refreshToken, 'refresh-orig', '网络错误保留 refreshToken 供下次重试');
  });

  it('getAuthStatus 响应绝不泄漏 refreshToken（安全边界）', async () => {
    const { send } = loadSW({
      storageSeed: expiredSeed(),
      fetchImpl: async () => ({
        ok: true, status: 200,
        async json() { return { access_token: 'tok-new', refresh_token: 'refresh-rotated', expires_in: 3600 }; },
        async text() { return JSON.stringify({ access_token: 'tok-new', refresh_token: 'refresh-rotated', expires_in: 3600 }); },
      }),
    });
    const resp = await send({ action: 'getAuthStatus' });
    assert.equal(Object.prototype.hasOwnProperty.call(resp.data, 'refreshToken'), false, 'refreshToken 只存 SW 侧');
    assert.equal(Object.prototype.hasOwnProperty.call(resp.data, 'refresh_token'), false);
  });

  it('oauthRefresh 显式消息：返回刷新后的 token 与剩余时间', async () => {
    const { send, refreshCalls } = loadSW({
      storageSeed: expiredSeed(),
      fetchImpl: async () => ({
        ok: true, status: 200,
        async json() { return { access_token: 'tok-new', refresh_token: 'refresh-rotated', expires_in: 3600 }; },
        async text() { return JSON.stringify({ access_token: 'tok-new', refresh_token: 'refresh-rotated', expires_in: 3600 }); },
      }),
    });
    const resp = await send({ action: 'oauthRefresh' });
    assert.equal(resp.success, true);
    assert.equal(resp.data.refreshed, true);
    assert.equal(resp.data.token, 'tok-new');
    assert.ok(resp.data.remainingSeconds > 0);
    assert.equal(refreshCalls.length, 1);
  });

  it('oauthRefresh 无 refresh token → refreshed:false 且不报错', async () => {
    const { send, refreshCalls } = loadSW({
      storageSeed: { baseUrl: 'https://aidevpush.com', token: 'tok-ok', tokenExpiresAt: FUTURE_AT, authExpiryMigratedV161: true },
      fetchImpl: async () => { throw new Error('should not be called'); },
    });
    const resp = await send({ action: 'oauthRefresh' });
    assert.equal(resp.success, true);
    assert.equal(resp.data.refreshed, false);
    assert.equal(resp.data.loggedIn, true);
    assert.equal(refreshCalls.length, 0);
  });
});
