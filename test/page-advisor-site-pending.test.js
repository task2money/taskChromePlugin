'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

require('./helpers/txRuntime.js').installTxRuntime();

const {
  parseSitePendingItems,
  filterSitePendingOnly,
  shouldFetchSitePending,
  isSkippableNavigationUrl,
  buildSitePendingCardHtml,
} = require('../lib/page-advisor-site-pending.js');

describe('PageAdvisorSitePending helpers', () => {
  it('parseSitePendingItems reads items array', () => {
    assert.deepEqual(parseSitePendingItems({ items: [{ id: '1' }] }), [{ id: '1' }]);
    assert.deepEqual(parseSitePendingItems([]), []);
  });

  it('filterSitePendingOnly keeps pending confirm_status', () => {
    const out = filterSitePendingOnly([
      { id: 'a', confirm_status: 'pending' },
      { id: 'b', confirm_status: 'confirmed' },
      { id: 'c', confirmStatus: 'dismissed' },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'a');
  });

  it('shouldFetchSitePending respects login and URL', () => {
    assert.equal(
      shouldFetchSitePending({
        token: 't',
        tokenExpired: false,
        pageUrl: 'https://app.example/page',
        isAuthRoute: false,
      }),
      true,
    );
    assert.equal(
      shouldFetchSitePending({ token: '', pageUrl: 'https://x.test' }),
      false,
    );
    assert.equal(
      shouldFetchSitePending({
        token: 't',
        pageUrl: 'https://x.test',
        isAuthRoute: true,
      }),
      false,
    );
  });

  it('isSkippableNavigationUrl skips browser internal URLs', () => {
    assert.equal(isSkippableNavigationUrl('chrome://extensions'), true);
    assert.equal(isSkippableNavigationUrl('https://example.test/a'), false);
  });

  it('buildSitePendingCardHtml includes confirm/dismiss controls', () => {
    const html = buildSitePendingCardHtml(
      { id: 'sug-1', title: 'T', summary: 'S' },
      0,
      (s) => s,
    );
    assert.match(html, /taskplugin-page-advisor-site-confirm/);
    assert.match(html, /taskplugin-page-advisor-site-dismiss/);
    assert.match(html, /data-sid="sug-1"/);
  });
});
