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
    chrome: {
      tabs: {
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
