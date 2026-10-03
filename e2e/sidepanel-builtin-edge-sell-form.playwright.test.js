/**
 * 侧栏「本机模型」Tab 本机模型出售表单（OPT-20261003-003）
 *
 * 覆盖：
 *  (1) 设置页（popup.html = 侧栏设置 iframe 同源文档）不出现「本机模型出售」标题
 *  (2) 登录后切「本机模型」Tab，#builtinEdgeSellSection 可见且 select 含 mock offers
 *  (3) 点注册后 POST 路径含所选 offer id，body 含 install_fingerprint
 *
 * 运行：bash e2e/sidepanel-builtin-edge-sell-form.playwright.test.js.sh
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
const POPUP_URL = pathToFileURL(path.join(__dirname, '..', 'popup', 'popup.html')).href;

const API_BASE = 'https://api.edge-sell.test';
const OFFERS = [
  { id: 'offer-aaa', title: '家用台式机', status: 'active' },
  { id: 'offer-bbb', title: '办公室主机', status: 'paused' },
];

/**
 * Install a chrome.* + fetch + LanguageModel stub before page scripts run.
 * @param {import('@playwright/test').Page} page
 * @param {{loggedIn?:boolean}} [opts]
 */
async function installStub(page, opts) {
  const loggedIn = opts?.loggedIn !== false;
  await page.addInitScript(({ base, offers, isLoggedIn }) => {
    try { localStorage.setItem('aidevpush.locale', 'zh-CN'); } catch (_) { /* ignore */ }
    const localStore = { 'aidevpush.locale': 'zh-CN' };
    if (isLoggedIn) {
      localStore.baseUrl = base;
      localStore.token = 'test-token';
      localStore.userId = 'user-1';
    }
    const sessionStore = {};
    const listeners = [];
    const fire = (bag, area) => {
      const changes = {};
      Object.keys(bag).forEach((k) => { changes[k] = { newValue: bag[k] }; });
      listeners.forEach((fn) => fn(changes, area));
    };
    // Supports both promise and Chrome callback forms (get(keys, cb) / set(obj, cb) / remove(keys, cb)).
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

    // Builtin model probe must short-circuit to [] without a real LanguageModel.
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

    // Capture SaaS requests; answer offers list + node registration.
    window.__edgeRequests = [];
    const realFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const rec = { url, method, body: init && init.body ? String(init.body) : '' };
      window.__edgeRequests.push(rec);
      if (url.includes('/api/cloud/v1/builtin-edge/offers')) {
        const nodeMatch = url.match(/\/offers\/([^/]+)\/nodes$/);
        if (nodeMatch && method === 'GET') {
          return new Response(JSON.stringify({ items: [] }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }
        if (nodeMatch && method === 'POST') {
          return new Response(JSON.stringify({ id: 'node-xyz', status: 'active' }), {
            status: 201, headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ items: offers }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (realFetch) return realFetch(input, init);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }, { base: API_BASE, offers: OFFERS, isLoggedIn: loggedIn });
}

test.describe('侧栏本机模型出售表单', () => {
  test('设置页不出现「本机模型出售」区块与表单入口', async ({ page }) => {
    await installStub(page);
    await page.goto(POPUP_URL);
    // 设置页（侧栏设置 iframe 同源文档）不得含出售区块 / 项目下拉 / 注册按钮。
    // 说明：用户指南仍会以文字介绍「本机模型出售」，故只断言表单结构缺失。
    await expect(page.locator('#builtinEdgeSellSection')).toHaveCount(0);
    await expect(page.locator('[data-testid=builtin-edge-sell-plugin]')).toHaveCount(0);
    await expect(page.locator('#builtinEdgeProjectId')).toHaveCount(0);
    await expect(page.locator('#btnBuiltinEdgeRegister')).toHaveCount(0);
  });

  test('登录后切「本机模型」Tab：区块可见且 select 含 mock offers', async ({ page }) => {
    await installStub(page, { loggedIn: true });
    await page.goto(SIDEPANEL_URL);
    await page.locator('[data-testid=sp-tab-builtin]').click();

    const section = page.locator('#builtinEdgeSellSection');
    await expect(section).toBeVisible({ timeout: 15000 });

    const sel = page.locator('#builtinEdgeProjectId');
    await expect(sel).toHaveValue('', { timeout: 10000 });
    await expect(sel.locator('option')).toHaveCount(OFFERS.length + 1);
    await expect(sel.locator('option[value="offer-aaa"]')).toHaveText('家用台式机');
    // paused suffix applied
    await expect(sel.locator('option[value="offer-bbb"]')).toHaveText('办公室主机 (已暂停)');
  });

  test('选择项目后注册：POST 路径含所选 offer id，body 含指纹', async ({ page }) => {
    await installStub(page, { loggedIn: true });
    await page.goto(SIDEPANEL_URL);
    await page.locator('[data-testid=sp-tab-builtin]').click();

    const sel = page.locator('#builtinEdgeProjectId');
    await expect(sel.locator('option[value="offer-aaa"]')).toHaveCount(1, { timeout: 15000 });
    await sel.selectOption('offer-aaa');
    await page.locator('#builtinEdgeDeviceLabel').fill('柜台主机 A');
    await page.locator('#btnBuiltinEdgeRegister').click();

    // 等待注册 POST 落地
    await expect.poll(async () => {
      const reqs = await page.evaluate(() => window.__edgeRequests);
      return reqs.some((r) => r.method === 'POST'
        && r.url.includes('/api/cloud/v1/builtin-edge/offers/offer-aaa/nodes'));
    }, { timeout: 10000 }).toBe(true);

    const reqs = await page.evaluate(() => window.__edgeRequests);
    const reg = reqs.find((r) => r.method === 'POST'
      && r.url.includes('/api/cloud/v1/builtin-edge/offers/offer-aaa/nodes'));
    expect(reg).toBeTruthy();
    const body = JSON.parse(reg.body);
    expect(body.device_label).toBe('柜台主机 A');
    expect(body.install_fingerprint).toMatch(/^pf_[0-9a-f]+_/);
    expect(Array.isArray(body.supported_models)).toBe(true);

    // SW keepalive 拉起消息带注册坐标
    const msgs = await page.evaluate(() => window.__edgeMessages || []);
    expect(msgs.some((m) => m.action === 'startBuiltinEdgeTunnel'
      && m.projectId === 'offer-aaa'
      && m.nodeId === 'node-xyz')).toBe(true);
  });
});
