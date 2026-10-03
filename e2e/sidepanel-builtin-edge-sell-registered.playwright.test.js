/**
 * 侧栏「本机模型」Tab：已注册态与取消注册（OPT-20261003-004）
 *
 * 覆盖：
 *  (1) mock active tunnel + GET nodes 后断言 registration/call/fingerprint 明细
 *  (2) 点「取消注册」→ POST nodes/<id>/revoke + SW stopBuiltinEdgeTunnel 消息
 *  (3) 指纹行沿用节点 install_fingerprint（SaaS 节点卡片契约同上，
 *      taskFE BuiltinEdgeSell.nodes.test.js 已覆盖 data-testid=builtin-edge-node-fingerprint）
 *
 * 运行：bash e2e/sidepanel-builtin-edge-sell-registered.playwright.test.js.sh
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

const API_BASE = 'https://api.edge-sell.test';
const ACTIVE = { projectId: 'offer-aaa', nodeId: 'node-xyz', deviceLabel: '柜台主机 A' };
const OFFERS = [{ id: 'offer-aaa', title: '家用台式机', status: 'active' }];
const NODE = {
  id: 'node-xyz',
  status: 'active',
  device_label: '柜台主机 A',
  install_fingerprint: 'pf_deadbeef01234567',
  supported_models: ['gemini-nano'],
  inflight: 1,
  max_concurrency: 2,
  dispatch_count: 5,
  success_count: 4,
  error_count: 1,
  last_seen_at: '2026-10-03T10:00:00Z',
  last_dispatch_at: '2026-10-03T09:59:00Z',
};

async function installStub(page) {
  await page.addInitScript(({ base, offers, node, active }) => {
    try { localStorage.setItem('aidevpush.locale', 'zh-CN'); } catch (_) { /* ignore */ }
    const localStore = {
      'aidevpush.locale': 'zh-CN',
      baseUrl: base,
      token: 'test-token',
      userId: 'user-1',
      builtinEdgeActiveTunnel: active,
    };
    const sessionStore = {};
    const listeners = [];
    const fire = (bag, area) => {
      const changes = {};
      Object.keys(bag).forEach((k) => { changes[k] = { newValue: bag[k] }; });
      listeners.forEach((fn) => fn(changes, area));
    };
    const area = (store, name) => ({
      get(keys, cb) {
        let out;
        if (typeof keys === 'string') out = { [keys]: store[keys] };
        else {
          const list = Array.isArray(keys) ? keys : Object.keys(store);
          out = {};
          for (const k of list) out[k] = store[k];
        }
        if (typeof cb === 'function') { cb(out); return undefined; }
        return Promise.resolve(out);
      },
      set(obj, cb) {
        Object.assign(store, obj);
        fire(obj, name);
        if (typeof cb === 'function') { cb(); return undefined; }
        return Promise.resolve();
      },
      remove(keys, cb) {
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach((k) => { delete store[k]; });
        if (typeof cb === 'function') { cb(); return undefined; }
        return Promise.resolve();
      },
    });

    window.LanguageModel = {
      async availability() { return 'unavailable'; },
      async create() { return { inputQuota: 4096, destroy() {} }; },
    };

    window.chrome = {
      runtime: {
        getManifest: () => ({ version: '1.8.170', content_scripts: [{ js: [] }] }),
        getURL: (p) => p,
        sendMessage: async (msg) => {
          window.__edgeMessages = window.__edgeMessages || [];
          window.__edgeMessages.push(msg);
          // 模拟 SW：stop 时清空 active tunnel 存储，贴近真实时序
          if (msg && msg.action === 'stopBuiltinEdgeTunnel') {
            delete localStore.builtinEdgeActiveTunnel;
          }
          return { success: true };
        },
        onMessage: { addListener() {} },
        lastError: null,
        id: 'test-ext',
      },
      storage: {
        local: area(localStore, 'local'),
        session: area(sessionStore, 'session'),
        onChanged: {
          addListener(fn) { listeners.push(fn); },
          removeListener(fn) {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
          },
        },
      },
      tabs: {
        async query() { return [{ id: 1, url: 'https://example.com' }]; },
        async create() { return { id: 2 }; },
        sendMessage: async () => {},
        onActivated: { addListener() {} },
      },
      sidePanel: { onOpened: { addListener() {} } },
    };

    window.__edgeRequests = [];
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      window.__edgeRequests.push({ url, method, body: init && init.body ? String(init.body) : '' });
      const json = (obj, status) => new Response(JSON.stringify(obj), {
        status: status || 200, headers: { 'Content-Type': 'application/json' },
      });
      const nodeList = url.match(/\/api\/cloud\/v1\/builtin-edge\/offers\/([^/]+)\/nodes$/);
      if (nodeList && method === 'GET') return json({ items: [node] });
      const revoke = url.match(/\/api\/cloud\/v1\/builtin-edge\/nodes\/([^/]+)\/revoke$/);
      if (revoke && method === 'POST') return json({ ok: true });
      if (url.includes('/api/cloud/v1/builtin-edge/offers')) return json({ items: offers });
      return json({});
    };
  }, { base: API_BASE, offers: OFFERS, node: NODE, active: ACTIVE });
}

test.describe('侧栏本机模型出售：已注册态', () => {
  test('mock active tunnel + GET nodes：展示注册情况/调用情况/指纹', async ({ page }) => {
    await installStub(page);
    await page.goto(SIDEPANEL_URL);
    await page.locator('[data-testid=sp-tab-builtin]').click();

    const registered = page.locator('#builtinEdgeSellRegisteredPanel');
    await expect(registered).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#builtinEdgeSellRegisterPanel')).toBeHidden();

    const regLines = page.locator('#builtinEdgeRegistrationLines');
    await expect(regLines).toContainText('家用台式机');
    await expect(regLines).toContainText('node-xyz');
    await expect(regLines).toContainText('active');
    await expect(regLines).toContainText('pf_deadbeef01234567');
    await expect(regLines).toContainText('柜台主机 A');
    await expect(regLines).toContainText('gemini-nano');

    const callLines = page.locator('#builtinEdgeCallLines');
    await expect(callLines).toContainText('1/2');
    await expect(callLines).toContainText('5');
    await expect(callLines).toContainText('4');
    await expect(callLines).toContainText('1');
    await expect(callLines).toContainText('2026-10-03T09:59:00Z');
  });

  test('点取消注册：POST revoke 命中节点，SW 收到 stopBuiltinEdgeTunnel', async ({ page }) => {
    await installStub(page);
    await page.goto(SIDEPANEL_URL);
    await page.locator('[data-testid=sp-tab-builtin]').click();

    await expect(page.locator('#btnBuiltinEdgeUnregister')).toBeVisible({ timeout: 15000 });
    await page.locator('#btnBuiltinEdgeUnregister').click();

    await expect.poll(async () => {
      const reqs = await page.evaluate(() => window.__edgeRequests);
      return reqs.some((r) => r.method === 'POST'
        && r.url.includes('/api/cloud/v1/builtin-edge/nodes/node-xyz/revoke'));
    }, { timeout: 10000 }).toBe(true);

    await expect.poll(async () => {
      const msgs = await page.evaluate(() => window.__edgeMessages || []);
      return msgs.some((m) => m.action === 'stopBuiltinEdgeTunnel');
    }, { timeout: 10000 }).toBe(true);

    await expect(page.locator('#builtinEdgeSellStatus')).toContainText('已取消注册');
  });
});
