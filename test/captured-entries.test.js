'use strict';

/**
 * captured-entries.js 回归单测（OPT-20260808-019 捕获条目瘦身）
 *
 * 背景：SW webRequest 捕获链路对每个请求（默认全状态码）都保存完整请求/响应头，
 * 满仓 500 条时 session storage 数组可达 0.6-3MB，且每次请求都全量读改写。
 * 修复：2xx/3xx 成功请求只存最小字段集（不带头），4xx/5xx/canceled 保留
 * 裁剪掉敏感头后的完整头（诊断价值），并拒绝存储敏感头（authorization/cookie 等）。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const CapturedEntries = require('../lib/captured-entries.js');

const {
  buildCapturedEntry,
  shouldStoreHeaders,
  redactHeaders,
  SENSITIVE_HEADER_NAMES,
} = CapturedEntries;

function makeHeaders() {
  return {
    'content-type': 'application/json',
    authorization: 'Token at_xxx_secret',
    cookie: 'session=abc',
    'x-trace-id': 'trace-123',
    'set-cookie': 'sid=1',
    'x-api-key': 'sk-live-abc',
    'user-agent': 'test-agent',
  };
}

describe('buildCapturedEntry 字段分层', () => {
  it('2xx 成功请求只存最小字段，不存任何 headers', () => {
    const entry = buildCapturedEntry({
      url: 'https://aidevpush.com/api/tasks/?page=2',
      method: 'GET',
      statusCode: 200,
      statusLine: 'OK',
      type: 'xmlhttprequest',
      timeStamp: 12345,
      tabId: 7,
      requestHeaders: makeHeaders(),
      responseHeaders: makeHeaders(),
      canceled: false,
      error: '',
    });

    assert.equal(entry.url, 'https://aidevpush.com/api/tasks/?page=2');
    assert.equal(entry.statusCode, 200);
    assert.equal(entry.tabId, 7);
    assert.equal(entry.requestHeaders, undefined, '2xx 不得携带请求头');
    assert.equal(entry.responseHeaders, undefined, '2xx 不得携带响应头');
    assert.equal(entry.canceled, false);
    assert.ok(entry.id, '保留 id');
    assert.ok(entry.capturedAt == null, 'capturedAt 由 Storage 层统一添加');
  });

  it('3xx 成功类请求同样不存 headers', () => {
    const entry = buildCapturedEntry({
      url: 'https://aidevpush.com/api/x',
      method: 'GET',
      statusCode: 302,
      statusLine: 'Found',
      type: 'main_frame',
      timeStamp: 1,
      tabId: 1,
      requestHeaders: { 'user-agent': 'a' },
      responseHeaders: { location: '/login' },
      canceled: false,
      error: '',
    });
    assert.equal(entry.statusCode, 302);
    assert.equal(entry.requestHeaders, undefined);
    assert.equal(entry.responseHeaders, undefined);
  });

  it('4xx 错误请求保留裁剪后的完整头', () => {
    const entry = buildCapturedEntry({
      url: 'https://aidevpush.com/api/tasks/',
      method: 'POST',
      statusCode: 404,
      statusLine: 'Not Found',
      type: 'xmlhttprequest',
      timeStamp: 2,
      tabId: 7,
      requestHeaders: makeHeaders(),
      responseHeaders: makeHeaders(),
      canceled: false,
      error: '',
    });

    assert.equal(entry.requestHeaders['user-agent'], 'test-agent');
    assert.equal(entry.requestHeaders['x-trace-id'], 'trace-123');
    assert.equal(entry.requestHeaders.authorization, undefined, 'authorization 必须裁剪');
    assert.equal(entry.requestHeaders.cookie, undefined, 'cookie 必须裁剪');
    assert.equal(entry.requestHeaders['x-api-key'], undefined, 'x-api-key 必须裁剪');
    assert.equal(entry.responseHeaders['content-type'], 'application/json');
    assert.equal(entry.responseHeaders['set-cookie'], undefined, 'set-cookie 必须裁剪');
  });

  it('5xx 错误请求保留裁剪后的完整头', () => {
    const entry = buildCapturedEntry({
      url: 'https://aidevpush.com/api/tasks/',
      method: 'GET',
      statusCode: 503,
      statusLine: 'Service Unavailable',
      type: 'xmlhttprequest',
      timeStamp: 3,
      tabId: 7,
      requestHeaders: makeHeaders(),
      responseHeaders: makeHeaders(),
      canceled: false,
      error: '',
    });
    assert.equal(entry.statusCode, 503);
    assert.equal(entry.requestHeaders['x-trace-id'], 'trace-123');
    assert.equal(entry.requestHeaders.authorization, undefined);
  });

  it('canceled 请求保留裁剪后的完整头（诊断价值）', () => {
    const entry = buildCapturedEntry({
      url: 'https://aidevpush.com/api/stream',
      method: 'GET',
      statusCode: 0,
      statusLine: 'Canceled',
      type: 'xmlhttprequest',
      timeStamp: 4,
      tabId: 7,
      requestHeaders: makeHeaders(),
      responseHeaders: {},
      canceled: true,
      error: 'net::ERR_ABORTED',
    });
    assert.equal(entry.canceled, true);
    assert.equal(entry.error, 'net::ERR_ABORTED');
    assert.equal(entry.requestHeaders['user-agent'], 'test-agent');
    assert.equal(entry.requestHeaders.cookie, undefined);
  });

  it('headers 为空或非对象时不报错', () => {
    const entry = buildCapturedEntry({
      url: 'https://aidevpush.com/api/x',
      method: 'GET',
      statusCode: 500,
      statusLine: 'ERR',
      type: 'xmlhttprequest',
      timeStamp: 5,
      tabId: 1,
      requestHeaders: undefined,
      responseHeaders: null,
      canceled: false,
      error: '',
    });
    assert.deepEqual(entry.requestHeaders, {});
    assert.deepEqual(entry.responseHeaders, {});
  });
});

describe('shouldStoreHeaders', () => {
  it('4xx/5xx/canceled 存头，2xx/3xx 不存头', () => {
    assert.equal(shouldStoreHeaders(200, false), false);
    assert.equal(shouldStoreHeaders(301, false), false);
    assert.equal(shouldStoreHeaders(404, false), true);
    assert.equal(shouldStoreHeaders(500, false), true);
    assert.equal(shouldStoreHeaders(599, false), true);
    assert.equal(shouldStoreHeaders(0, true), true);
  });
});

describe('redactHeaders', () => {
  it('SENSITIVE_HEADER_NAMES 覆盖常见凭据头', () => {
    for (const name of ['authorization', 'cookie', 'proxy-authorization', 'set-cookie', 'x-api-key', 'api-key']) {
      assert.ok(SENSITIVE_HEADER_NAMES.has(name), `${name} 应在敏感名单内`);
    }
  });

  it('大小写不敏感裁剪', () => {
    const out = redactHeaders({ Authorization: 'Bearer x', 'X-Trace-Id': 't' });
    assert.equal(out.Authorization, undefined);
    assert.equal(out['X-Trace-Id'], 't');
  });

  it('不修改原始对象（返回新对象）', () => {
    const src = { 'user-agent': 'a', authorization: 'x' };
    redactHeaders(src);
    assert.equal(src.authorization, 'x', '原始对象不得被修改');
  });
});
