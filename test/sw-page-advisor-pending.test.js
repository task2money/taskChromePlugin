'use strict';

const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');

function loadPendingStack(extraSandbox = {}) {
  const sent = [];
  const sandbox = {
    console,
    URL,
    chrome: {
      tabs: {
        query: async () => [{ id: 3, url: 'https://shop.test/p' }],
        sendMessage: async (_tabId, msg) => {
          sent.push(msg);
          return { success: true };
        },
      },
      webNavigation: { onCompleted: { addListener: () => {} } },
    },
    Storage: {
      migrateStaleTokenExpiryOnce: async () => {},
      getApiConfig: async () => ({ token: 't', baseUrl: 'https://example.test' }),
      getEndpointMapping: async () => ({}),
      getCredentials: async () => ({ userId: 'u1' }),
      isTokenExpired: async () => false,
      getLastWorkspace: async () => 'ws1',
    },
    API: {
      init: () => {},
      setOwner: () => {},
      getWorkspaces: async () => [{ id: 'ws1', company_id: 'ten1' }],
    },
    PageAdvisorDefaults: {
      resolvePageAdvisorWorkspace: () => ({
        workspaceId: 'ws1',
        companyId: 'ten1',
        source: 'test',
      }),
    },
    PageAdvisorAPI: {
      listPendingSuggestions: async () => ({
        items: [{ id: 'p1', title: 'Pending', confirm_status: 'pending' }],
      }),
      confirmSuggestion: async () => ({ id: 'p1', confirm_status: 'confirmed' }),
      dismissSuggestion: async () => ({ id: 'p1', confirm_status: 'dismissed' }),
    },
    PageAdvisorSitePending: null,
    ...extraSandbox,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // 与真实 SW 同构：i18n 先于业务脚本装载（OPT-20260919-009 第 7 批）。
  require('./helpers/txRuntime.js').installTxInSandbox(sandbox);

  for (const rel of [
    'lib/page-advisor-site-pending.js',
    'background/sw-page-advisor-pending.js',
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, rel), 'utf8'),
      sandbox,
      { filename: path.basename(rel) },
    );
  }
  sandbox.PageAdvisorSitePending = sandbox.globalThis.PageAdvisorSitePending;
  return { sandbox, sent };
}

describe('sw-page-advisor-pending', () => {
  it('refreshSitePendingForTab notifies content with pending items', async () => {
    const { sandbox, sent } = loadPendingStack();
    const result = await sandbox.refreshSitePendingForTab(3, 'https://shop.test/p', { force: true });
    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].action, 'pageAdvisorSitePending');
    assert.equal(sent[0].tenantId, 'ten1');
    assert.equal(sent[0].items[0].id, 'p1');
    assert.equal(sent[0].items[0].tenant_id, 'ten1');
  });

  it('refreshSitePendingForTab asks every company the user can open', async () => {
    const calls = [];
    const { sandbox, sent } = loadPendingStack({
      API: {
        init: () => {},
        setOwner: () => {},
        getWorkspaces: async () => [
          { id: 'ws1', company_id: 'ten1' },
          { id: 'ws2', company_id: 'ten2' },
        ],
      },
      PageAdvisorAPI: {
        listPendingSuggestions: async (tenantId) => {
          calls.push(tenantId);
          return {
            items: [{ id: `${tenantId}-s`, title: 'T', confirm_status: 'pending' }],
          };
        },
        confirmSuggestion: async () => ({ id: 'p1', confirm_status: 'confirmed' }),
        dismissSuggestion: async () => ({ id: 'p1', confirm_status: 'dismissed' }),
      },
    });
    const result = await sandbox.refreshSitePendingForTab(4, 'https://shop.test/p', { force: true });
    assert.equal(result.ok, true);
    assert.equal(result.count, 2);
    assert.deepEqual(calls.sort(), ['ten1', 'ten2']);
    assert.equal(sent[0].items[0].tenant_id, 'ten1');
    assert.equal(sent[0].items[1].tenant_id, 'ten2');
  });

  it('侧边栏与页面浮层都固定按当前网页查，且始终丢掉网址参数', async () => {
    const calls = [];
    const { sandbox } = loadPendingStack({
      PageAdvisorAPI: {
        listPendingSuggestions: async (_tenantId, pageUrl) => {
          calls.push(pageUrl);
          return { items: [] };
        },
        confirmSuggestion: async () => ({ id: 'p1', confirm_status: 'confirmed' }),
        dismissSuggestion: async () => ({ id: 'p1', confirm_status: 'dismissed' }),
      },
    });
    sandbox.chrome.tabs.query = async () => [{ id: 3, url: 'https://www.aidevpush.com/?accessCode=token#top' }];
    await sandbox.handleListSitePendingForActiveTab();
    await sandbox.refreshSitePendingForTab(9, 'https://www.aidevpush.com/pricing?plan=pro', { force: true });
    assert.deepEqual(calls, [
      'https://www.aidevpush.com/',
      'https://www.aidevpush.com/pricing',
    ]);
    // 消息里塞了别的网址也不再改口径：列表永远跟随当前网页（ADR-0167）。
    calls.length = 0;
    await sandbox.handleListSitePendingForActiveTab({ pageUrl: 'https://other.test/docs?q=1' });
    assert.deepEqual(calls, ['https://www.aidevpush.com/']);
  });

  it('selectAgentSuggestionPost forwards the sticker to the active tab', async () => {
    const { sandbox, sent } = loadPendingStack();
    const skipped = await sandbox.handleSelectAgentSuggestionPost({
      applyToPage: false,
      postId: 'p1',
    });
    assert.equal(skipped.skipped, true);
    assert.equal(sent.length, 0);
    const result = await sandbox.handleSelectAgentSuggestionPost({
      applyToPage: true,
      postId: 'p1',
      item: { id: 'p1', title: 'Pending' },
    });
    assert.equal(result.success, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].action, 'selectAgentSuggestionPost');
    assert.equal(sent[0].postId, 'p1');
    assert.equal(sent[0].item.id, 'p1');
  });

  it('listSitePendingForActiveTab returns posts for the agent suggestions tab', async () => {
    const { sandbox } = loadPendingStack();
    const result = await sandbox.handleListSitePendingForActiveTab();
    assert.equal(result.success, true);
    assert.equal(result.pageUrl, 'https://shop.test/p');
    assert.equal(result.items[0].id, 'p1');
    assert.equal(result.items[0].tenant_id, 'ten1');
  });

  it('a logged-in reload queries once past the debounce and publishes the count', async () => {
    const calls = [];
    const published = [];
    const { sandbox } = loadPendingStack({
      PageAdvisorAPI: {
        listPendingSuggestions: async () => {
          calls.push(1);
          return {
            items: [
              { id: 'a', confirm_status: 'pending' },
              { id: 'b', confirm_status: 'pending' },
              { id: 'c', confirm_status: 'confirmed' },
            ],
          };
        },
        confirmSuggestion: async () => ({ id: 'a', confirm_status: 'confirmed' }),
        dismissSuggestion: async () => ({ id: 'a', confirm_status: 'dismissed' }),
      },
    });
    let listener = null;
    sandbox.chrome.webNavigation = {
      onCompleted: { addListener(fn) { listener = fn; } },
    };
    sandbox.chrome.runtime = {
      sendMessage(payload) {
        published.push(payload);
        return Promise.resolve();
      },
    };
    sandbox.registerPageAdvisorSitePendingHooks();
    await listener({ frameId: 1, tabId: 3, url: 'https://shop.test/p', transitionType: 'reload' });
    assert.equal(calls.length, 0);
    await listener({ frameId: 0, tabId: 3, url: 'https://shop.test/p', transitionType: 'link' });
    await listener({ frameId: 0, tabId: 3, url: 'https://shop.test/p', transitionType: 'link' });
    assert.equal(calls.length, 1);
    await listener({ frameId: 0, tabId: 3, url: 'https://shop.test/p', transitionType: 'reload' });
    assert.equal(calls.length, 2);
    const last = published[published.length - 1];
    assert.equal(last.action, 'agentSuggestionsListed');
    assert.equal(last.count, 2);
    assert.equal(last.tabId, 3);
  });

  it('a reload while logged out does not call the list API', async () => {
    const calls = [];
    const published = [];
    const { sandbox } = loadPendingStack({
      Storage: {
        migrateStaleTokenExpiryOnce: async () => {},
        getApiConfig: async () => ({ token: '', baseUrl: 'https://example.test' }),
        getEndpointMapping: async () => ({}),
        getCredentials: async () => ({ userId: '' }),
        isTokenExpired: async () => false,
        getLastWorkspace: async () => '',
      },
      PageAdvisorAPI: {
        listPendingSuggestions: async () => {
          calls.push(1);
          return { items: [] };
        },
        confirmSuggestion: async () => ({ id: 'p1', confirm_status: 'confirmed' }),
        dismissSuggestion: async () => ({ id: 'p1', confirm_status: 'dismissed' }),
      },
    });
    let listener = null;
    sandbox.chrome.webNavigation = {
      onCompleted: { addListener(fn) { listener = fn; } },
    };
    sandbox.chrome.runtime = {
      sendMessage(payload) {
        published.push(payload);
        return Promise.resolve();
      },
    };
    sandbox.registerPageAdvisorSitePendingHooks();
    await listener({ frameId: 0, tabId: 8, url: 'https://shop.test/p', transitionType: 'reload' });
    assert.equal(calls.length, 0);
    assert.equal(published[0].count, 0);
    assert.equal(published[0].reason, 'not_logged_in');
  });

  it('confirmSitePendingSuggestion requires Idempotency-Key', async () => {
    const { sandbox } = loadPendingStack();
    const bad = await sandbox.handleConfirmSitePendingSuggestion({
      tenantId: 'ten1',
      suggestionId: 'p1',
    });
    assert.equal(bad.success, false);
    const ok = await sandbox.handleConfirmSitePendingSuggestion({
      tenantId: 'ten1',
      suggestionId: 'p1',
      idempotencyKey: 'ik-1',
    });
    assert.equal(ok.success, true);
  });
});
