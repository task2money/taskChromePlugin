'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isRequestListMessage,
  createRequestMessageBuffer,
  mergeFallbackRecentRequests,
  mustRefreshRequestListUiAfterFallback,
  resolveRequestListPlaceholder,
} = require('../lib/panel-request-bootstrap.js');

describe('isRequestListMessage', () => {
  it('accepts initRequests / newRequest / requestUpdated', () => {
    assert.equal(isRequestListMessage({ action: 'initRequests' }), true);
    assert.equal(isRequestListMessage({ action: 'newRequest' }), true);
    assert.equal(isRequestListMessage({ action: 'requestUpdated' }), true);
  });

  it('rejects unrelated or empty payloads', () => {
    assert.equal(isRequestListMessage(null), false);
    assert.equal(isRequestListMessage({ action: 'ping' }), false);
  });
});

describe('createRequestMessageBuffer — race: initRequests before consumer ready', () => {
  it('buffers early initRequests and drains after setConsumer', () => {
    const buf = createRequestMessageBuffer();
    const seen = [];
    assert.equal(buf.push({ action: 'initRequests', requests: [{ id: 'a' }] }), true);
    assert.equal(buf.pendingCount, 1);
    assert.equal(buf.ready, false);

    const drained = buf.setConsumer((data) => seen.push(data));
    assert.equal(drained, 1);
    assert.equal(buf.ready, true);
    assert.equal(buf.pendingCount, 0);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].requests[0].id, 'a');
  });

  it('delivers live messages after consumer is ready (no re-buffer)', () => {
    const buf = createRequestMessageBuffer();
    const seen = [];
    buf.setConsumer((data) => seen.push(data.action));
    buf.push({ action: 'newRequest', request: { id: 'b' } });
    assert.deepEqual(seen, ['newRequest']);
    assert.equal(buf.pendingCount, 0);
  });

  it('ignores non-request messages', () => {
    const buf = createRequestMessageBuffer();
    assert.equal(buf.push({ action: 'authStateChanged' }), false);
    assert.equal(buf.pendingCount, 0);
  });
});

describe('mergeFallbackRecentRequests', () => {
  it('keeps local list when non-empty', () => {
    const local = [{ id: '1' }];
    const merged = mergeFallbackRecentRequests(local, {
      success: true,
      data: [{ id: 'sw' }],
    });
    assert.equal(merged[0].id, '1');
  });

  it('uses SW data when local empty and SW has rows', () => {
    const merged = mergeFallbackRecentRequests([], {
      success: true,
      data: [{ id: 'sw' }],
    });
    assert.equal(merged[0].id, 'sw');
  });

  it('stays empty when both local and SW are empty', () => {
    const merged = mergeFallbackRecentRequests([], { success: true, data: [] });
    assert.deepEqual(merged, []);
  });
});

describe('mustRefreshRequestListUiAfterFallback', () => {
  it('always true so empty SW fallback clears loading placeholder', () => {
    assert.equal(mustRefreshRequestListUiAfterFallback(), true);
  });
});

describe('resolveRequestListPlaceholder', () => {
  it('loading until bootstrapped with zero items', () => {
    assert.equal(resolveRequestListPlaceholder({ count: 0, bootstrapped: false }), 'loading');
  });

  it('empty after bootstrap with zero items (not stuck loading)', () => {
    assert.equal(resolveRequestListPlaceholder({ count: 0, bootstrapped: true }), 'empty');
  });

  it('list when count > 0', () => {
    assert.equal(resolveRequestListPlaceholder({ count: 3, bootstrapped: true }), 'list');
  });
});

/**
 * 回归：旧 init 在 await refreshAuthState 之后才挂 message 监听，
 * 且 SW 空列表时不调用 applyRequestFilters → 永久「正在加载请求列表...」。
 */
describe('panel init request-list bootstrap pattern', () => {
  it('early initRequests + empty SW fallback leaves UI empty not loading', async () => {
    const buf = createRequestMessageBuffer();
    let recentRequests = [];
    let bootstrapped = false;
    let placeholder = 'loading';

    function applyFilters() {
      bootstrapped = true;
      placeholder = resolveRequestListPlaceholder({
        count: recentRequests.length,
        bootstrapped,
      });
    }

    function handleMessage(data) {
      if (data.action === 'initRequests') {
        recentRequests = data.requests || [];
        applyFilters();
      }
    }

    // 模拟 onShown 早于 init await 结束
    buf.push({ action: 'initRequests', requests: [] });

    // 模拟 init：先挂 consumer（修复后），再 await auth
    await Promise.resolve(); // stand-in for refreshAuthState
    buf.setConsumer(handleMessage);

    // SW 兜底为空也必须刷新
    const swRes = { success: true, data: [] };
    if (recentRequests.length === 0) {
      recentRequests = mergeFallbackRecentRequests(recentRequests, swRes);
    }
    if (mustRefreshRequestListUiAfterFallback()) {
      applyFilters();
    }

    assert.equal(placeholder, 'empty');
    assert.notEqual(placeholder, 'loading');
  });

  it('broken pattern: late listener + no refresh on empty SW stays loading', async () => {
    let recentRequests = [];
    let placeholder = 'loading';
    let listener = null;

    // 早到消息丢失
    const early = { action: 'initRequests', requests: [] };
    if (listener) listener(early);

    await Promise.resolve();
    listener = (data) => {
      if (data.action === 'initRequests') {
        recentRequests = data.requests || [];
        placeholder = 'empty';
      }
    };

    // 旧代码：仅 success && length > 0 才刷新
    const swRes = { success: true, data: [] };
    if (recentRequests.length === 0) {
      if (swRes.success && swRes.data?.length > 0) {
        recentRequests = swRes.data;
        placeholder = 'empty';
      }
    }

    assert.equal(placeholder, 'loading');
  });
});
