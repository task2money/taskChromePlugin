'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { withTimeout } = require('../lib/async-timeout.js');
const {
  scheduleAuthBroadcast,
  persistLoginCredentials,
  finalizeLoginSuccess,
} = require('../lib/login-finalize.js');

describe('scheduleAuthBroadcast', () => {
  it('does not await hanging broadcast — finalize returns while broadcast still pending', async () => {
    let broadcastStarted = false;
    let finalizeDone = false;

    const hangingBroadcast = () => new Promise(() => {
      broadcastStarted = true;
    });

    const done = finalizeLoginSuccess({
      saveApiConfig: async () => {},
      saveCredentials: async () => {},
      baseUrl: 'https://aidevpush.com',
      token: 'session-token',
      expiresIn: 0,
      username: 'u@test.com',
      userId: '1',
      memberId: '2',
      withTimeout,
      timeoutMs: 200,
      broadcast: hangingBroadcast,
    }).then((r) => {
      finalizeDone = true;
      return r;
    });

    const result = await done;
    assert.equal(result.persisted, true);
    assert.equal(finalizeDone, true);
    // 给 microtask 一次机会启动广播
    await Promise.resolve();
    assert.equal(broadcastStarted, true);
  });

  it('scheduleAuthBroadcast never throws to caller', () => {
    assert.doesNotThrow(() => {
      scheduleAuthBroadcast(() => {
        throw new Error('boom');
      });
    });
  });
});

describe('persistLoginCredentials', () => {
  it('writes token and credentials via adapters', async () => {
    const calls = [];
    await persistLoginCredentials({
      saveApiConfig: async (baseUrl, token, expiresIn) => {
        calls.push(['saveApiConfig', baseUrl, token, expiresIn]);
      },
      saveCredentials: async (username, userId, memberId) => {
        calls.push(['saveCredentials', username, userId, memberId]);
      },
      baseUrl: 'https://aidevpush.com',
      token: '351fc90c6d0b447d4d0deebe09bc27c30a82b2b1',
      expiresIn: 0,
      username: 'ljy124818167@qq.com',
      userId: '850256676127797248',
      memberId: '850256677331562497',
      withTimeout,
      timeoutMs: 500,
    });
    assert.deepEqual(calls, [
      ['saveApiConfig', 'https://aidevpush.com', '351fc90c6d0b447d4d0deebe09bc27c30a82b2b1', 0],
      ['saveCredentials', 'ljy124818167@qq.com', '850256676127797248', '850256677331562497'],
    ]);
  });

  it('times out when storage hangs so login response can proceed', async () => {
    await assert.rejects(
      () => persistLoginCredentials({
        saveApiConfig: () => new Promise(() => {}),
        saveCredentials: async () => {},
        baseUrl: 'https://aidevpush.com',
        token: 'tok',
        expiresIn: 0,
        username: 'u',
        userId: '',
        memberId: '',
        withTimeout,
        timeoutMs: 40,
      }),
      /保存登录态超时/,
    );
  });
});
