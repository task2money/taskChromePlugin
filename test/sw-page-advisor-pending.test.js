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
      getLastWorkspaceManual: async () => null,
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
        getLastWorkspaceManual: async () => null,
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

/**
 * v233：匿名试用落下的优化贴在登录前后都要出现在列表里，
 * 读不到/已关闭的入口从本地删掉，读回成功则用服务端真身刷新快照。
 */
describe('sw-page-advisor-pending 匿名优化贴', () => {
  const ANON_KEY = 'pa_anon_posts_v1';
  const PAGE_URL = 'https://shop.test/p';

  function anonEntry(overrides = {}) {
    return {
      post_id: 'anon-1',
      view_token: 'tok-1',
      page_url: PAGE_URL,
      expires_at: '2026-11-04T09:00:00Z',
      created_at: '2026-10-28T08:00:00Z',
      title: '把 CTA 提到首屏',
      summary: '首屏没有按钮',
      detail: '把主按钮上移',
      claim_status: 'open',
      suggestions: [{ id: 's1', title: '移动 CTA', dom_id: 'hero-cta' }],
      ...overrides,
    };
  }

  function loadAnonStack({ entries = [anonEntry()], loggedIn = false, trial = {}, storage } = {}) {
    const local = { [ANON_KEY]: entries };
    const localStore = storage || {
      get: async (key) => ({ [key]: local[key] }),
      set: async (items) => { Object.assign(local, items); },
    };
    const { sandbox, sent } = loadPendingStack({
      Storage: {
        migrateStaleTokenExpiryOnce: async () => {},
        getApiConfig: async () => ({
          token: loggedIn ? 't' : '',
          baseUrl: 'https://example.test',
        }),
        getEndpointMapping: async () => ({}),
        getCredentials: async () => ({ userId: loggedIn ? 'u1' : '' }),
        isTokenExpired: async () => false,
        getLastWorkspace: async () => 'ws1',
        getLastWorkspaceManual: async () => null,
      },
      PluginInstallFingerprint: { ensurePluginInstallFingerprint: async () => 'pf_1' },
      PageAdvisorTrialAPI: {
        getPost: async (_baseUrl, postId) => ({
          post_id: postId,
          title: '服务端标题',
          summary: '服务端摘要',
          detail: '服务端详情',
          suggestions: [{ id: 's1', title: '服务端建议', dom_id: 'hero-cta' }],
          claim_status: 'open',
          created_at: '2026-10-28T08:00:00Z',
          expires_at: '2026-11-04T09:00:00Z',
        }),
        ...trial,
      },
      chrome: {
        tabs: {
          query: async () => [{ id: 3, url: PAGE_URL }],
          sendMessage: async (_tabId, msg) => {
            sent.push(msg);
            return { success: true };
          },
        },
        webNavigation: { onCompleted: { addListener: () => {} } },
        storage: { local: localStore },
      },
    });
    for (const rel of ['lib/page-advisor-anon-posts.js', 'background/sw-page-advisor-page-trial.js']) {
      vm.runInContext(
        fs.readFileSync(path.join(ROOT, rel), 'utf8'),
        sandbox,
        { filename: path.basename(rel) },
      );
    }
    sandbox.PageAdvisorAnonPosts = sandbox.globalThis.PageAdvisorAnonPosts;
    return { sandbox, sent, local };
  }

  it('未登录：本机匿名贴照常列出，并投递到页面浮层', async () => {
    const { sandbox, sent, local } = loadAnonStack();
    const result = await sandbox.refreshSitePendingForTab(3, `${PAGE_URL}?utm=1`, { force: true });
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'not_logged_in');
    assert.equal(result.count, 1);
    assert.equal(result.items[0].id, 'anon-1');
    assert.equal(result.items[0].anonymous, true);
    assert.equal(result.items[0].title, '服务端标题', '读回成功用服务端真身刷新快照');
    assert.equal(local[ANON_KEY][0].title, '服务端标题');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].action, 'pageAdvisorSitePending');
    assert.equal(sent[0].items[0].id, 'anon-1');
  });

  it('读回 404 / 410：入口已作废，从本地删掉且不再列出', async () => {
    for (const status of [404, 410]) {
      const { sandbox, local } = loadAnonStack({
        trial: {
          getPost: async () => {
            const err = new Error('gone');
            err.status = status;
            throw err;
          },
        },
      });
      const result = await sandbox.refreshSitePendingForTab(3, PAGE_URL, { force: true });
      assert.equal(result.count, 0, `status ${status}`);
      assert.deepEqual(local[ANON_KEY], [], `status ${status} 删掉本地入口`);
    }
  });

  it('网络失败：用本地快照兜底，刷新页面仍看得见', async () => {
    const { sandbox, local } = loadAnonStack({
      trial: {
        getPost: async () => {
          const err = new Error('network down');
          err.status = 0;
          throw err;
        },
      },
    });
    const result = await sandbox.refreshSitePendingForTab(3, PAGE_URL, { force: true });
    assert.equal(result.count, 1);
    assert.equal(result.items[0].title, '把 CTA 提到首屏', '快照标题');
    assert.equal(local[ANON_KEY].length, 1, '读不到不算作废，入口保留');
  });

  it('已登录：登录列表在前，本机匿名入口补在后面且同 id 去重', async () => {
    const { sandbox } = loadAnonStack({ loggedIn: true, entries: [anonEntry(), anonEntry({ post_id: 'anon-2', view_token: 'tok-2' })] });
    const result = await sandbox.refreshSitePendingForTab(3, PAGE_URL, { force: true });
    assert.equal(result.ok, true);
    assert.equal(result.reason, '');
    const ids = result.items.map((item) => item.id);
    assert.deepEqual([...ids], ['p1', 'anon-1', 'anon-2']);
    assert.equal(result.items[0].tenant_id, 'ten1');
  });

  it('领取任务贴：未登录直接拒绝，不发领取请求', async () => {
    const claims = [];
    const { sandbox } = loadAnonStack();
    sandbox.PageAdvisorAPI.claimPageTrialPost = async (...args) => {
      claims.push(args);
      return { post_id: 'landing-1' };
    };
    const resp = await sandbox.handleClaimPageTrialPost({ postId: 'anon-1' });
    assert.equal(resp.success, false);
    assert.equal(resp.errorCode, 'not_logged_in');
    assert.equal(claims.length, 0);
  });

  it('领取任务贴：登录后按本地令牌领取，成功后删掉本地入口', async () => {
    const claims = [];
    const { sandbox, local } = loadAnonStack({ loggedIn: true });
    sandbox.PageAdvisorAPI.claimPageTrialPost = async (...args) => {
      claims.push(args);
      return {
        post_id: 'landing-1',
        task_id: 'task-1',
        project_id: 'p-1',
        project_name: '我的项目',
        workspace_id: 'ws-1',
        already_claimed: false,
      };
    };
    const resp = await sandbox.handleClaimPageTrialPost({ postId: 'anon-1' });
    assert.equal(resp.success, true);
    assert.equal(resp.projectName, '我的项目');
    assert.equal(claims.length, 1);
    const [tenantId, postId, viewToken, idempotencyKey] = claims[0];
    assert.equal(tenantId, 'ten1');
    assert.equal(postId, 'anon-1');
    assert.equal(viewToken, 'tok-1', '令牌由后台按帖 id 从本地入口取');
    assert.ok(idempotencyKey, '领取必须带幂等键');
    assert.deepEqual(local[ANON_KEY], [], '领取成功后本地入口消失');
  });

  it('领取任务贴：410 已领取/过期，本地入口同样清掉', async () => {
    const { sandbox, local } = loadAnonStack({ loggedIn: true });
    sandbox.PageAdvisorAPI.claimPageTrialPost = async () => {
      const err = new Error('page_trial_post_claimed');
      err.status = 410;
      err.errorCode = 'page_trial_post_claimed';
      throw err;
    };
    const resp = await sandbox.handleClaimPageTrialPost({ postId: 'anon-1' });
    assert.equal(resp.success, false);
    assert.equal(resp.status, 410);
    assert.deepEqual(local[ANON_KEY], []);
  });
});
