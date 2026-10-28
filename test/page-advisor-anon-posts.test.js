'use strict';

/**
 * 匿名优化贴的本地访问入口（v233）：
 * 试用落贴后把「帖 id + 只读令牌」存在扩展本地，刷新页面仍能看、能领取。
 * 纯函数部分钉形状与上限，存储部分钉「过期清理 / 领取后删除 / 并发不互相覆盖」。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Anon = require('../lib/page-advisor-anon-posts.js');

const NOW = Date.parse('2026-10-28T09:00:00Z');

function memoryStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    async get(key) {
      return { [key]: store[key] };
    },
    async set(items) {
      Object.assign(store, items);
    },
  };
}

function entry(overrides = {}) {
  return {
    post_id: 'post-1',
    view_token: 'tok-1',
    page_url: 'https://shop.test/p?utm=1',
    expires_at: '2026-11-04T09:00:00Z',
    created_at: '2026-10-28T08:00:00Z',
    title: '把 CTA 提到首屏',
    summary: '首屏没有按钮',
    detail: '把主按钮上移',
    prompt_tendency: 'conversion',
    claim_status: 'open',
    suggestions: [{ id: 's1', title: '移动 CTA', dom_id: 'hero-cta' }],
    ...overrides,
  };
}

describe('page-advisor-anon-posts 纯函数', () => {
  it('网址口径与生成/查询一致：去掉查询串与片段', () => {
    assert.equal(Anon.canonicalPageUrl('https://shop.test/p?utm=1#top'), 'https://shop.test/p');
    assert.equal(Anon.canonicalPageUrl('https://shop.test/p'), 'https://shop.test/p');
    assert.equal(Anon.canonicalPageUrl(''), '');
    // 解析不了的原文保留，宁可多存一条也不丢入口
    assert.equal(Anon.canonicalPageUrl('not a url'), 'not a url');
  });

  it('缺帖 id / 令牌 / 网址的入口一律不收', () => {
    assert.equal(Anon.normalizeEntry(null), null);
    assert.equal(Anon.normalizeEntry(entry({ post_id: '' })), null);
    assert.equal(Anon.normalizeEntry(entry({ view_token: ' ' })), null);
    assert.equal(Anon.normalizeEntry(entry({ page_url: '' })), null);
  });

  it('快照只留定位字段，并截断超长文本', () => {
    const row = Anon.normalizeEntry(entry({
      detail: 'x'.repeat(5000),
      suggestions: [{ id: 's1', title: 'T'.repeat(500), html_snippet: 'y'.repeat(5000), dom_id: 'n1' }],
    }));
    assert.equal(row.detail.length, 2000);
    assert.equal(row.suggestions[0].html_snippet, undefined, '整页 HTML 片段不落盘');
    assert.equal(row.suggestions[0].dom_id, 'n1');
    assert.equal(row.suggestions[0].title.length, 300);
  });

  it('写入按帖 id 覆盖、按有效期清理、最多留 50 条', () => {
    let list = [];
    for (let i = 0; i < 55; i += 1) {
      list = Anon.upsertEntry(list, entry({
        post_id: `post-${i}`,
        created_at: new Date(NOW + i * 1000).toISOString(),
      }), NOW);
    }
    assert.equal(list.length, Anon.MAX_ENTRIES);
    assert.equal(list[0].post_id, 'post-5', '最旧的先出');

    const replaced = Anon.upsertEntry(list, entry({ post_id: 'post-10', title: '改过' }), NOW);
    assert.equal(replaced.filter((row) => row.post_id === 'post-10').length, 1);
    assert.equal(replaced.find((row) => row.post_id === 'post-10').title, '改过');

    const expired = Anon.upsertEntry(replaced, entry({
      post_id: 'post-old',
      expires_at: '2026-10-28T08:59:59Z',
    }), NOW);
    assert.equal(expired.some((row) => row.post_id === 'post-old'), false);

    const swept = Anon.upsertEntry(
      replaced.map((row) => ({ ...row, expires_at: '2026-10-28T08:00:00Z' })),
      null,
      NOW,
    );
    assert.deepEqual(swept, [], '过期项在下次写入时清掉');
  });

  it('按页取入口：只回同页、未过期的', () => {
    const list = [
      entry({ post_id: 'p-1' }),
      entry({ post_id: 'p-2', page_url: 'https://shop.test/p' }),
      entry({ post_id: 'p-3', page_url: 'https://shop.test/other' }),
      entry({ post_id: 'p-4', expires_at: '2026-10-28T08:00:00Z' }),
    ];
    const rows = Anon.entriesForPageUrl(list, 'https://shop.test/p?utm=2', NOW);
    assert.deepEqual(rows.map((row) => row.post_id), ['p-1', 'p-2']);
  });

  it('入口映射成侧栏条目：匿名标记、无租户、保留令牌', () => {
    const item = Anon.itemFromEntry(entry());
    assert.equal(item.id, 'post-1');
    assert.equal(item.post_id, 'post-1');
    assert.equal(item.anonymous, true);
    assert.equal(item.owner_kind, 'anonymous');
    assert.equal(item.confirm_status, 'pending');
    assert.equal(item.tenant_id, '');
    assert.equal(item.view_token, 'tok-1');
    assert.equal(Anon.itemFromEntry(null), null);
  });

  it('试用响应 → 本地入口；读回真身 → 覆盖快照但保留令牌', () => {
    const built = Anon.entryFromTrialPost({
      post: { post_id: 'post-9', view_token: 'tok-9', page_url: 'https://shop.test/p?x=1', expires_at: '2026-11-04T09:00:00Z' },
      pageUrl: 'https://shop.test/p',
      pageTitle: '商品页',
      suggestions: [{ id: 's1', title: '建议一', summary: '摘要', detail: '详情', dom_id: 'n1' }],
      copy: { title: '建议一', summary: '摘要', detail: '详情' },
      promptTendency: 'conversion',
      nowMs: NOW,
    });
    assert.equal(built.post_id, 'post-9');
    assert.equal(built.page_url, 'https://shop.test/p');
    assert.equal(built.title, '建议一');
    assert.equal(built.created_at, '2026-10-28T09:00:00.000Z');

    const merged = Anon.entryFromPublicView(built, {
      post_id: 'post-9',
      title: '服务端标题',
      summary: '服务端摘要',
      detail: '服务端详情',
      suggestions: [{ id: 's1', title: '服务端建议', dom_id: 'n1' }],
      claim_status: 'open',
      created_at: '2026-10-28T08:00:00Z',
      expires_at: '2026-11-05T09:00:00Z',
    });
    assert.equal(merged.title, '服务端标题');
    assert.equal(merged.suggestions[0].title, '服务端建议');
    assert.equal(merged.view_token, 'tok-9', '令牌不因读回而改变');
    assert.equal(merged.expires_at, '2026-11-05T09:00:00Z');
  });

  it('无 post 字段即不落入口（落贴失败只有即时建议）', () => {
    assert.equal(Anon.entryFromTrialPost({ pageUrl: 'https://shop.test/p' }), null);
    assert.equal(Anon.entryFromTrialPost({ post: { post_id: 'p' } }), null);
  });
});

describe('page-advisor-anon-posts 本地存储', () => {
  it('写入 / 读回 / 删除，存的是同一个形状', async () => {
    const storage = memoryStorage();
    const saved = await Anon.rememberEntry(storage, entry(), NOW);
    assert.equal(saved.post_id, 'post-1');
    const rows = await Anon.listEntriesForPageUrl(storage, 'https://shop.test/p', NOW);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].view_token, 'tok-1');

    assert.equal(await Anon.forgetEntry(storage, 'post-1'), true);
    assert.equal(await Anon.forgetEntry(storage, 'post-1'), false, '重复删除是幂等的');
    assert.deepEqual(await Anon.listEntriesForPageUrl(storage, 'https://shop.test/p', NOW), []);
  });

  it('读回时顺手清掉过期入口', async () => {
    const storage = memoryStorage();
    await Anon.rememberEntry(storage, entry({ post_id: 'live', expires_at: '2026-11-04T09:00:00Z' }), NOW);
    await Anon.rememberEntry(storage, entry({ post_id: 'stale', expires_at: '2026-10-28T08:00:00Z' }), NOW + 1000);
    const rows = await Anon.listEntriesForPageUrl(storage, 'https://shop.test/p', NOW + 1000);
    assert.deepEqual(rows.map((row) => row.post_id), ['live']);
  });

  it('并发写入不互相覆盖', async () => {
    const storage = memoryStorage();
    await Promise.all([
      Anon.rememberEntry(storage, entry({ post_id: 'a', created_at: '2026-10-28T08:00:00Z' }), NOW),
      Anon.rememberEntry(storage, entry({ post_id: 'b', created_at: '2026-10-28T08:01:00Z' }), NOW),
      Anon.rememberEntry(storage, entry({ post_id: 'c', created_at: '2026-10-28T08:02:00Z' }), NOW),
    ]);
    const rows = await Anon.listEntriesForPageUrl(storage, 'https://shop.test/p', NOW);
    assert.deepEqual(rows.map((row) => row.post_id).sort(), ['a', 'b', 'c']);
  });

  it('存储抛错时安静降级，不把列表刷新带崩', async () => {
    const broken = {
      async get() { throw new Error('quota'); },
      async set() { throw new Error('quota'); },
    };
    assert.deepEqual(await Anon.loadEntries(broken), []);
    assert.equal(await Anon.rememberEntry(broken, entry(), NOW), null);
    assert.equal(await Anon.forgetEntry(broken, 'post-1'), false);
  });
});
