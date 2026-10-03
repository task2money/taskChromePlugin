/**
 * Popup 内置模型：session 卡在采集中时，刷新/下载必须立刻改状态行。
 *
 * 运行：bash e2e/popup-builtin-stuck-collecting.playwright.test.js.sh
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
const POPUP_URL = pathToFileURL(path.join(__dirname, '..', 'popup', 'popup.html')).href;
const COLLECTING = '正在采集页面并生成优化建议';

async function installStub(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('aidevpush.locale', 'zh-CN'); } catch (_) { /* ignore */ }
    const localStore = {
      baseUrl: 'https://aidevpush.com',
      token: '',
      'aidevpush.locale': 'zh-CN',
    };
    const sessionStore = {
      pageAdvisorBuiltinRuntime: {
        phase: 'collecting',
        availability: 'downloadable',
        updatedAt: Date.now(),
      },
    };
    const listeners = [];
    const fire = (bag, area) => {
      const changes = {};
      Object.keys(bag).forEach((k) => { changes[k] = { newValue: bag[k] }; });
      listeners.forEach((fn) => fn(changes, area));
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
    });
    window.LanguageModel = {
      availability: async () => 'downloadable',
      async create(opts) {
        if (opts && typeof opts.monitor === 'function') {
          opts.monitor({
            addEventListener(type, handler) {
              if (type === 'downloadprogress' && handler) handler({ loaded: 1, total: 4 });
            },
          });
        }
        return { destroy() {}, inputQuota: 4096 };
      },
    };
    window.chrome = {
      runtime: {
        getManifest: () => ({ version: '1.8.163' }),
        sendMessage: async (msg) => {
          if (msg && msg.action === 'getAuthStatus') {
            return {
              success: true,
              data: {
                baseUrl: localStore.baseUrl,
                token: '',
                loggedIn: false,
                remainingSeconds: -1,
              },
            };
          }
          return { success: true };
        },
        lastError: null,
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
      tabs: { async query() { return []; }, sendMessage: async () => {} },
    };
  });
}

test.describe('Popup 内置模型卡住采集中', () => {
  test('刷新与下载点击后状态行离开采集中文案', async ({ page }) => {
    await installStub(page);
    await page.goto(POPUP_URL);
    await expect(page.locator('#popupLlmRouteBuiltinWrap')).toBeVisible({ timeout: 15000 });
    await page.locator('#popupLlmRouteBuiltin').check();
    const status = page.locator('#popupBuiltinStatus');
    await expect(status).toBeVisible({ timeout: 10000 });
    await expect(status).not.toContainText(COLLECTING);
    await expect(page.locator('#btnRefreshBuiltinStatus')).toBeVisible();
    await expect(page.locator('#btnDownloadBuiltinModel')).toBeVisible();

    await page.locator('#btnRefreshBuiltinStatus').click();
    await expect(status).not.toContainText(COLLECTING);
    await expect(status).toContainText(/刷新|尚未下载|需要下载|Refreshing|download/i);

    await page.locator('#btnDownloadBuiltinModel').click();
    await expect(status).toContainText(/下载|download/i);
    await expect(status).not.toContainText(COLLECTING);
  });
});
