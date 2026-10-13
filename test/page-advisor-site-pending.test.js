'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

require('./helpers/txRuntime.js').installTxRuntime();
require('../lib/task-detail-href.js');

const {
  parseSitePendingItems,
  filterSitePendingOnly,
  tenantIdsForSitePending,
  shouldFetchSitePending,
  isSkippableNavigationUrl,
  buildSitePendingTabsHtml,
  pageUrlForAgentSuggestions,
  sitePendingGeneratedDate,
  pickSitePendingPostId,
  sitePendingPostsAfterMark,
  agentSuggestionTabBadge,
  nextSitePendingPageAction,
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
    assert.match(html, /1 条建议/);
    assert.equal(pickSitePendingPostId(posts, 'p1'), 'p1');
    assert.equal(pickSitePendingPostId(posts, 'gone'), 'p2');
    assert.deepEqual(
      sitePendingPostsAfterMark(posts, 'p2').map((post) => post.id),
      ['p1'],
    );
  });

  it('shows the generation date, suggestion count, and prompt type on a post', () => {
    const html = buildSitePendingTabsHtml([
      {
        id: 'p1',
        title: '自定义 · https://aidevpush.com/blog/togaf-saas-workflow',
        tenantId: 'ten-1',
        created_at: '2026-10-12T04:00:00Z',
        prompt_tendency: 'seo',
        suggestions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      },
    ], 'p1', (s) => s);
    assert.match(html, /taskplugin-page-advisor-post-tab-meta/);
    assert.match(html, /2026-10-12/);
    assert.match(html, /3 条建议/);
    assert.match(html, /SEO/);
    const fallback = buildSitePendingTabsHtml([
      { id: 'p2', title: '自定义', tenant_id: 'ten-2', suggestions: [] },
    ], 'p2', (s) => s);
    assert.match(fallback, /1 条建议/);
    assert.match(fallback, /自定义/);
    assert.doesNotMatch(fallback, /2026-/);
  });

  it('renders the generation date in the browser local calendar', () => {
    const prevTz = process.env.TZ;
    process.env.TZ = 'Asia/Shanghai';
    try {
      // 2026-10-12T17:00:00Z is 2026-10-13 01:00 in UTC+8.
      assert.equal(
        sitePendingGeneratedDate({ created_at: '2026-10-12T17:00:00Z' }),
        '2026-10-13',
      );
      assert.equal(
        sitePendingGeneratedDate({ createdAt: '2026-10-12T20:00:00+08:00' }),
        '2026-10-12',
      );
      // A date-only prefix and an empty value keep their literal output.
      assert.equal(sitePendingGeneratedDate({ created_at: '2026-10-12' }), '2026-10-12');
      assert.equal(sitePendingGeneratedDate({}), '');
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });

  it('drops the query string and fragment before looking a page up', () => {
    const raw = 'https://www.aidevpush.com/?accessCode=token#top';
    assert.equal(pageUrlForAgentSuggestions(raw), 'https://www.aidevpush.com/');
    assert.equal(
      pageUrlForAgentSuggestions('https://shop.test/pricing?plan=pro'),
      'https://shop.test/pricing',
    );
    assert.equal(pageUrlForAgentSuggestions('not a url'), 'not a url');
    assert.equal(pageUrlForAgentSuggestions(''), '');
  });

  it('uses a smaller adopt and discard and links the saved task', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const css = fs.readFileSync(path.join(__dirname, '../sidepanel/sidepanel.css'), 'utf8');
    assert.match(css, /#sp-pane-agent \.taskplugin-page-advisor-site-compact \{[^}]*min-height: 24px;/s);
    const post = {
      id: 'p1',
      tenant_id: 'co',
      workspace_id: 'ws',
      task_id: 'task-9',
      title: '自定义',
    };
    const html = buildSitePendingTabsHtml([post], 'p1', (s) => s, 'https://www.aidevpush.com');
    assert.match(html, /taskplugin-page-advisor-site-compact taskplugin-page-advisor-site-dismiss/);
    assert.match(html, /taskplugin-page-advisor-site-compact taskplugin-page-advisor-site-confirm/);
    assert.match(html, /href="https:\/\/www\.aidevpush\.com\/tenant\/co\/workspace\/ws\/task-detail\/task-9\/"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer"/);
    assert.match(html, />打开帖子</);
    const bare = buildSitePendingTabsHtml(
      [{ id: 'p1', tenant_id: 'co', task_id: 'task-9', title: '自定义' }],
      'p1',
      (s) => s,
      'https://www.aidevpush.com',
    );
    assert.equal(bare.includes('<a '), false);
  });

  it('tab badge shows the pending post count and hides at zero', () => {
    assert.deepEqual(agentSuggestionTabBadge(0), { visible: false, text: '' });
    assert.deepEqual(agentSuggestionTabBadge(2), { visible: true, text: '2' });
    assert.deepEqual(agentSuggestionTabBadge('3'), { visible: true, text: '3' });
  });

  it('keeps the suggestion overlay off the page until a sidebar sticker is selected', () => {
    const posts = [
      { id: 'a', suggestions: [{ id: 's1', title: '改标题' }] },
      { id: 'b', suggestions: [] },
    ];
    const listed = nextSitePendingPageAction('list', posts, 'a', { selectedBySidebar: false });
    assert.equal(listed.kind, 'hide-overlay');
    assert.equal(listed.showPostTabs, false);
    const selected = nextSitePendingPageAction('sidebar-select', posts, 'a', { selectedBySidebar: true });
    assert.equal(selected.kind, 'show-suggestion');
    assert.equal(selected.postId, 'a');
    assert.equal(selected.showPostTabs, false);
    const unanchored = nextSitePendingPageAction('sidebar-select', posts, 'b', { selectedBySidebar: true });
    assert.equal(unanchored.kind, 'hide-overlay');
    assert.equal(unanchored.showPostTabs, false);
    const refreshed = nextSitePendingPageAction('list', posts, 'a', { selectedBySidebar: true });
    assert.equal(refreshed.kind, 'show-suggestion');
    assert.equal(refreshed.postId, 'a');
  });

});
