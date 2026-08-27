'use strict';

/**
 * CPU 热路径守卫回归测试。
 *
 * 缺陷：插件注入所有页面后，长时间使用 CPU 暴涨。根因不是单次尖峰，而是
 * （1）隐藏标签页仍跑 60s auth 角标 interval，getAuthStatus 重叠打 SW；
 * （2）mousemove / pick mouseover 在未拖拽、未选元素时仍挂在 document；
 * （3）webRequest onBeforeRequest 对 GET 仍走 requestBody 热路径。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Guards = require('../lib/hot-path-guards.js');

describe('shouldRunPeriodicAuthTick', () => {
  it('隐藏页跳过（修复前 hidden 仍 tick → N 标签页打 SW）', () => {
    assert.equal(Guards.shouldRunPeriodicAuthTick({ hidden: true, inFlight: false }), false);
  });

  it('上一拍未完成则跳过（修复前 setInterval+async 重叠）', () => {
    assert.equal(Guards.shouldRunPeriodicAuthTick({ hidden: false, inFlight: true }), false);
  });

  it('可见且空闲则执行', () => {
    assert.equal(Guards.shouldRunPeriodicAuthTick({ hidden: false, inFlight: false }), true);
  });
});

describe('shouldCacheWebRequestBody', () => {
  it('捕获关闭时不缓存 body（避免 Chrome 为扩展缓冲所有 POST）', () => {
    assert.equal(Guards.shouldCacheWebRequestBody({
      tabId: 1, method: 'POST',
    }, false), false);
  });

  it('GET/HEAD/OPTIONS 不缓存（轮询热路径）', () => {
    assert.equal(Guards.shouldCacheWebRequestBody({ tabId: 1, method: 'GET' }, true), false);
    assert.equal(Guards.shouldCacheWebRequestBody({ tabId: 1, method: 'HEAD' }, true), false);
    assert.equal(Guards.shouldCacheWebRequestBody({ tabId: 1, method: 'OPTIONS' }, true), false);
  });

  it('tabId<0（扩展自身/内部）跳过', () => {
    assert.equal(Guards.shouldCacheWebRequestBody({ tabId: -1, method: 'POST' }, true), false);
  });

  it('POST + 捕获开启则缓存', () => {
    assert.equal(Guards.shouldCacheWebRequestBody({ tabId: 3, method: 'POST' }, true), true);
  });
});

describe('WEB_REQUEST_BODY_TYPES', () => {
  it('不含 image/script/stylesheet/font/media/ping（静态资源不进 body 捕获）', () => {
    const types = Guards.WEB_REQUEST_BODY_TYPES;
    assert.ok(types.includes('xmlhttprequest'));
    for (const t of ['image', 'script', 'stylesheet', 'font', 'media', 'ping']) {
      assert.ok(!types.includes(t), `${t} 不应出现在 body 捕获 types`);
    }
  });
});
