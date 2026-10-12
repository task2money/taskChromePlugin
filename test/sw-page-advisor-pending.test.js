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

  it('side panel and page overlay drop the query unless the option is on', async () => {
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
    sandbox.chrome.storage = { local: { get: async () => ({}) } };
    sandbox.chrome.tabs.query = async () => [{ id: 3, url: 'https://www.aidevpush.com/?accessCode=token#top' }];
    await sandbox.handleListSitePendingForActiveTab();
    await sandbox.refreshSitePendingForTab(9, 'https://www.aidevpush.com/pricing?plan=pro', { force: true });
    assert.deepEqual(calls, [
      'https://www.aidevpush.com/',
      'https://www.aidevpush.com/pricing',
    ]);
    sandbox.chrome.storage.local.get = async () => ({ agentSuggestionsIncludeQuery: true });
    calls.length = 0;
    await sandbox.handleListSitePendingForActiveTab();
    assert.equal(calls[0], 'https://www.aidevpush.com/?accessCode=token#top');
  });

  it('listSitePendingForActiveTab returns posts for the agent suggestions tab', async () => {
    const { sandbox } = loadPendingStack();
    const result = await sandbox.handleListSitePendingForActiveTab();
    assert.equal(result.success, true);
    assert.equal(result.pageUrl, 'https://shop.test/p');
    assert.equal(result.items[0].id, 'p1');
    assert.equal(result.items[0].tenant_id, 'ten1');
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
