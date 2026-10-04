/**
 * Popup 内置模型：点「下载模型」后进度到 100% 未 resolve 期间须显示「正在启用」，
 * 不得显示「尚未启用」；create resolve 后回到「已就绪」。
 *
 * 覆盖真实 DOM 手势下的 onProgress → status 文案切换，弥补 Node 单测看不到的
 * 侧栏/弹窗 hydrate 时序（进度事件与 create 挂起竞态）。
 *
 * 运行：bash e2e/popup-builtin-download-enabling.playwright.test.js.sh
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

const ENABLING = '正在启用';
const NOT_ENABLED = '尚未启用';
const READY = '已就绪';

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
        phase: 'idle',
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
    // create 挂起：进度同步打到 100%，测试通过 __builtinDownload.resolve 结束 create。
    const pending = { resolve: null, downloaded: false };
    window.__builtinDownload = pending;
    window.LanguageModel = {
      availability: async () => (pending.downloaded ? 'available' : 'downloadable'),
      create(opts) {
        if (opts && typeof opts.monitor === 'function') {
          opts.monitor({
            addEventListener(type, handler) {
              // loaded<=1 且 total<=1 视为比例值 → progressPercent=100
              if (type === 'downloadprogress' && handler) handler({ loaded: 1, total: 1 });
            },
          });
        }
        return new Promise((resolve) => {
          pending.resolve = () => resolve({ destroy() {}, inputQuota: 4096 });
        });
      },
    };
    window.chrome = {
      runtime: {
        getManifest: () => ({ version: '1.8.169' }),
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

test.describe('Popup 内置模型下载→启用文案', () => {
  test('进度 100% 显示正在启用（非尚未启用），create 完成后就绪', async ({ page }) => {
    await installStub(page);
    await page.goto(POPUP_URL);
    await expect(page.locator('#popupLlmRouteBuiltinWrap')).toBeVisible({ timeout: 15000 });
    await page.locator('#popupLlmRouteBuiltin').check();

    const status = page.locator('#popupBuiltinStatus');
    await expect(status).toBeVisible({ timeout: 10000 });
    const download = page.locator('#btnDownloadBuiltinModel');
    await expect(download).toBeVisible();
    await expect(download).toContainText(/下载/);

    await download.click();

    // 进度同步到 100%，create 仍挂起：应为「正在启用」，绝不能是「尚未启用」。
    await expect(status).toContainText(ENABLING, { timeout: 10000 });
    await expect(status).not.toContainText(NOT_ENABLED);
    const bar = page.locator('#popupBuiltinProgress');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('data-kind', 'enable');

    // 结束 create → 模型可用 → 就绪。
    await page.evaluate(() => {
      window.__builtinDownload.downloaded = true;
      if (window.__builtinDownload.resolve) window.__builtinDownload.resolve();
    });
    await expect(status).toContainText(READY, { timeout: 10000 });
    await expect(status).not.toContainText(ENABLING);
    await expect(bar).toBeHidden();

    // 成功路径：session 快照 lastErrorCode 为空。
    const snap = await page.evaluate(async () => {
      const bag = await chrome.storage.session.get('pageAdvisorBuiltinRuntime');
      return bag && bag.pageAdvisorBuiltinRuntime;
    });
    expect(snap && snap.availability).toBe('available');
    expect(snap && snap.lastErrorCode).toBe('');
    expect(snap && snap.downloadInFlight).toBe(false);
  });
});
