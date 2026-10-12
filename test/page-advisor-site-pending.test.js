'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

require('./helpers/txRuntime.js').installTxRuntime();

const {
  parseSitePendingItems,
  filterSitePendingOnly,
  tenantIdsForSitePending,
  shouldFetchSitePending,
  isSkippableNavigationUrl,
  buildSitePendingCardHtml,
  buildSitePendingDecisionHtml,
  buildSitePendingTabsHtml,
  buildSitePendingPostBodyHtml,
  pageUrlForAgentSuggestions,
  pickSitePendingPostId,
  sitePendingPostsAfterMark,
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
      { id: 'sug-1', title: 'T', summary: 'S', tenant_id: 'ten-9' },
      0,
      (s) => s,
    );
    assert.match(html, /taskplugin-page-advisor-site-confirm/);
    assert.match(html, /taskplugin-page-advisor-site-dismiss/);
    assert.match(html, /data-sid="sug-1"/);
    assert.match(html, /data-tenant="ten-9"/);
    assert.match(html, />采纳</);
    assert.match(html, />废弃</);
  });

  it('tenantIdsForSitePending keeps one id per company', () => {
    assert.deepEqual(
      tenantIdsForSitePending([
        { company_id: 'a' },
        { companyId: 'a' },
        { company: 'b' },
      ], 'c'),
      ['a', 'b'],
    );
    assert.deepEqual(tenantIdsForSitePending([], 'c'), ['c']);
  });

  it('shows a tab per pending post with adopt and discard on the entry', () => {
    const posts = [
      { id: 'p1', title: '首页标题', tenantId: 'ten-1' },
      { id: 'p2', title: '', tenant_id: 'ten-2' },
    ];
    assert.equal(buildSitePendingTabsHtml([], 'p1', (s) => s), '');
    const one = buildSitePendingTabsHtml([posts[0]], 'p1', (s) => s);
    assert.match(one, /data-post-id="p1"/);
    assert.match(one, /data-sid="p1"/);
    assert.match(one, /data-tenant="ten-1"/);
    assert.match(one, />采纳</);
    assert.match(one, />废弃</);
    const html = buildSitePendingTabsHtml(posts, 'p2', (s) => s);
    assert.match(html, /role="tab"/);
    assert.match(html, /data-post-id="p1"/);
    assert.match(html, /data-post-id="p2"/);
    assert.match(html, /aria-selected="false"/);
    assert.match(html, /data-post-id="p2" aria-selected="true"/);
    assert.match(html, /data-sid="p2"/);
    assert.match(html, /data-tenant="ten-2"/);
    assert.match(html, />首页标题</);
    assert.match(html, />建议 2</);
    assert.equal(pickSitePendingPostId(posts, 'p1'), 'p1');
    assert.equal(pickSitePendingPostId(posts, 'gone'), 'p2');
    assert.deepEqual(
      sitePendingPostsAfterMark(posts, 'p2').map((post) => post.id),
      ['p1'],
    );
  });

  it('buildSitePendingDecisionHtml marks adopt and discard on the saved row', () => {
    const html = buildSitePendingDecisionHtml('row-1', 'ten-9', (s) => s);
    assert.match(html, /data-sid="row-1"/);
    assert.match(html, /data-tenant="ten-9"/);
    assert.match(html, />采纳</);
  });

  it('drops the query string unless the agent suggestions option is on', () => {
    const raw = 'https://www.aidevpush.com/?accessCode=token#top';
    assert.equal(pageUrlForAgentSuggestions(raw, false), 'https://www.aidevpush.com/');
    assert.equal(pageUrlForAgentSuggestions(raw, true), raw);
    assert.equal(pageUrlForAgentSuggestions('not a url', false), 'not a url');
  });

  it('renders the selected post body for the agent suggestions tab', () => {
    const body = buildSitePendingPostBodyHtml({
      summary: '帖子摘要',
      suggestions: [{ title: '改标题', summary: '更短' }],
    }, (s) => s);
    assert.match(body, /帖子摘要/);
    assert.match(body, /改标题/);
    assert.match(body, /更短/);
  });
});
