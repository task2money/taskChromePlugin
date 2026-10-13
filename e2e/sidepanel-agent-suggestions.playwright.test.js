/**
 * 侧栏「智能体建议」在真 DOM 里画出来：页签数字、帖子列表、标记一帖。
 *
 * 背景（OPT-20261012-021 / OPT-20261012-023）：页签数字与帖子列表都由
 * `sidepanel/sidepanel.js` + `sidepanel/agent-suggestions-panel.js` 写进侧边栏 DOM，
 * 既有单测用假 DOM（`querySelectorAll` 恒返回空），只能证明消息形状与文案，
 * 证明不了列表真的被画出来、废掉一帖后真的少了那一行。这里把真实的
 * `sidepanel.html` 当普通扩展页加载（假 chrome，真 DOM），补上这一段。
 *
 * 运行：bash e2e/sidepanel-agent-suggestions.playwright.test.js.sh
 */
const path = require('path');
const { pathToFileURL } = require('url');

function loadPlaywrightTest() {
  try {
    return require('@playwright/test');
  } catch (_) {
    return require(path.resolve(__dirname, '../../task2app/playwright/node_modules/@playwright/test'));
  }
}

const { test, expect } = loadPlaywrightTest();
const SIDEPANEL_URL = pathToFileURL(path.join(__dirname, '..', 'sidepanel', 'sidepanel.html')).href;

const TENANT = '884588082601422848';
const ACTIVE_TAB_ID = 1;

const PENDING_POSTS = [
  { id: 'post-1', tenantId: TENANT, title: '首页标题改成一句话', created_at: '2026-10-12T02:00:00Z' },
  { id: 'post-2', tenantId: TENANT, title: '使用说明补一段接入步骤', created_at: '2026-10-12T03:00:00Z' },
];

const PENDING_POSTS_AFTER_QUERY = PENDING_POSTS.concat([
  { id: 'post-3', tenantId: TENANT, title: '定价页补对比表', created_at: '2026-10-12T04:00:00Z' },
]);

/**
 * 假 chrome：侧边栏脚本要的 API 都给一份，并把出站消息与注册的监听器暴露到 window，
 * 供用例断言「点了查询确实发了一次列表请求」「页签数字随列表消息更新」。
 * 列表接口的返回值放在 `window.__items`，用例可在点击前替换，模拟服务端多了一条。
 */
async function installStub(page, posts) {
  await page.addInitScript(({ seedPosts, tenantId, tabId }) => {
    try { localStorage.setItem('aidevpush.locale', 'zh-CN'); } catch (_) { /* ignore */ }
    const localStore = { 'aidevpush.locale': 'zh-CN' };
    const sessionStore = {};
    const storageListeners = [];
    const fire = (bag, area) => {
      const changes = {};
      Object.keys(bag).forEach((k) => { changes[k] = { newValue: bag[k] }; });
      storageListeners.forEach((fn) => fn(changes, area));
    };
    const area = (store, name) => ({
      async get(keys) {
        if (typeof keys === 'string') return { [keys]: store[keys] };
        const list = Array.isArray(keys) ? keys : Object.keys(store);
        const out = {};
        for (const k of list) out[k] = store[k];
        return out;
      },
      async set(obj) {
        Object.assign(store, obj);
        fire(obj, name);
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach((k) => { delete store[k]; });
      },
    });

    window.__items = seedPosts.slice();
    window.__sent = [];
    window.__msgListeners = [];

    // Anti-Replay-OK: 测试桩，非业务写路径
    const reply = (message) => {
      const action = message && message.action;
      if (action === 'listSitePendingForActiveTab' || action === 'refreshSitePendingForActiveTab') {
        return { success: true, items: window.__items.slice(), count: window.__items.length, tabId };
      }
      if (action === 'dismissSitePendingSuggestion' || action === 'confirmSitePendingSuggestion') {
        return { success: true, suggestionId: message.suggestionId, tenantId: message.tenantId };
      }
      if (action === 'getSidePanelOpenIntent') return { which: 'agent' };
      return {};
    };

    window.chrome = {
      runtime: {
        getManifest: () => ({ version: '1.8.260', content_scripts: [{ js: [] }] }),
        getURL: (p) => p,
        id: 'test-ext',
        lastError: null,
        async sendMessage(message) {
          window.__sent.push(message);
          return reply(message);
        },
        onMessage: {
          addListener(fn) { window.__msgListeners.push(fn); },
          removeListener(fn) {
            const i = window.__msgListeners.indexOf(fn);
            if (i >= 0) window.__msgListeners.splice(i, 1);
          },
        },
      },
      storage: {
        local: area(localStore, 'local'),
        session: area(sessionStore, 'session'),
        onChanged: {
          addListener(fn) { storageListeners.push(fn); },
          removeListener(fn) {
            const i = storageListeners.indexOf(fn);
            if (i >= 0) storageListeners.splice(i, 1);
          },
        },
      },
      tabs: {
        async query() { return [{ id: tabId }]; },
        async sendMessage() {},
        onActivated: { addListener() {} },
        onUpdated: { addListener() {} },
      },
      sidePanel: { onOpened: { addListener() {} } },
      i18n: { getMessage: () => '' },
    };
    void tenantId;
  }, { seedPosts: posts, tenantId: TENANT, tabId: ACTIVE_TAB_ID });
}

/** 后台 SW 把列表结果广播给侧栏（`agentSuggestionsListed`）。 */
async function broadcastListed(page, items) {
  await page.evaluate((payload) => {
    if (payload.tabId == null) payload.tabId = 1;
    (window.__msgListeners || []).slice().forEach((fn) => fn(payload));
  }, { action: 'agentSuggestionsListed', count: items.length, items });
}

async function sentActions(page) {
  return page.evaluate(() => (window.__sent || []).map((m) => m && m.action));
}

test.describe('侧栏智能体建议', () => {
  test('页签数字等于帖子数，点查询后列表与数字一起更新', async ({ page }) => {
    await installStub(page, PENDING_POSTS);
    await page.goto(SIDEPANEL_URL);

    const badge = page.locator('#sp-agent-count');
    const tab = page.locator('#sp-tab-agent');

    // 侧栏是带着「打开智能体建议」的意图打开的：数字画在页签上且等于帖子数，
    // 列表在真 DOM 里画出两行。刷新一次只各发一次列表请求，不重复打同一发。
    await expect(page.locator('#sp-pane-agent')).toBeVisible();
    await expect(page.locator('#sp-agent-posts [data-post-id]')).toHaveCount(2);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('2');
    await expect(tab).toHaveAttribute('data-count', '2');
    await expect(badge).toHaveAttribute('aria-label', /2/);
    const bootActions = await sentActions(page);
    expect(bootActions.filter((a) => a === 'refreshSitePendingForActiveTab')).toHaveLength(1);
    expect(bootActions.filter((a) => a === 'listSitePendingForActiveTab')).toHaveLength(1);

    // 后台再广播一次同一个列表：数字不叠加、也不丢。
    await broadcastListed(page, PENDING_POSTS);
    await expect(badge).toHaveText('2');
    await expect(page.locator('#sp-agent-posts [data-post-id]')).toHaveCount(2);

    // 服务端多了一条待处理：重新点开该页签后列表与数字一起变成 3。
    await page.evaluate((extra) => { window.__items = window.__items.concat([extra]); },
      { id: 'post-3', tenantId: TENANT, title: '定价页补对比表', created_at: '2026-10-12T04:00:00Z' });
    const before = (await sentActions(page)).filter((a) => a === 'listSitePendingForActiveTab').length;
    await tab.click();
    await expect(page.locator('#sp-agent-posts [data-post-id]')).toHaveCount(3);
    await expect(badge).toHaveText('3');
    const after = (await sentActions(page)).filter((a) => a === 'listSitePendingForActiveTab').length;
    expect(after).toBe(before + 1);

    // 一条都不剩时数字收起来，别留个 0 在页签上。
    await page.evaluate(() => { window.__items = []; });
    await tab.click();
    await expect(page.locator('#sp-agent-posts [data-post-id]')).toHaveCount(0);
    await expect(badge).toBeHidden();

    // 重新打开侧栏（等价于刷新网页后重新打开）：数字仍在页签上，不是空。
    await page.goto(SIDEPANEL_URL);
    await broadcastListed(page, PENDING_POSTS_AFTER_QUERY);
    await expect(page.locator('#sp-agent-count')).toHaveText('3');
  });

  test('点开智能体建议页签，标记一帖后该帖从列表消失', async ({ page }) => {
    await installStub(page, PENDING_POSTS);
    await page.goto(SIDEPANEL_URL);

    await page.locator('#sp-tab-agent').click();
    await expect(page.locator('#sp-pane-agent')).toBeVisible();

    const rows = page.locator('#sp-agent-posts .taskplugin-page-advisor-post-tab');
    await expect(rows).toHaveCount(2);
    await expect(page.locator('#sp-agent-posts .taskplugin-page-advisor-post-tab-title').first())
      .toContainText('首页标题');
    await expect(page.locator('#sp-agent-count')).toHaveText('2');

    // 废掉第一帖：请求带上帖子与租户，回来后列表少一行、数字跟着减。
    await page.locator('#sp-agent-posts .taskplugin-page-advisor-site-dismiss[data-sid="post-1"]').click();
    await expect(rows).toHaveCount(1);
    await expect(page.locator('#sp-agent-posts [data-post-id="post-1"]')).toHaveCount(0);
    await expect(page.locator('#sp-agent-posts [data-post-id="post-2"]')).toHaveCount(1);
    await expect(page.locator('#sp-agent-count')).toHaveText('1');

    const dismiss = await page.evaluate(() => (window.__sent || [])
      .filter((m) => m && m.action === 'dismissSitePendingSuggestion')
      .map((m) => ({ suggestionId: m.suggestionId, tenantId: m.tenantId, hasKey: !!m.idempotencyKey })));
    expect(dismiss).toHaveLength(1);
    expect(dismiss[0].suggestionId).toBe('post-1');
    expect(dismiss[0].tenantId).toBe(TENANT);
    expect(dismiss[0].hasKey).toBe(true);
  });
});
