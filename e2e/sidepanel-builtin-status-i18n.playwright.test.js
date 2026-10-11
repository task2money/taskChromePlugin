/**
 * 侧栏本机模型就绪时收起状态行，配额仍要探测出来。
 *
 * 运行：bash e2e/sidepanel-builtin-status-i18n.playwright.test.js.sh
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

async function installStub(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('aidevpush.locale', 'zh-CN'); } catch (_) { /* ignore */ }
    const localStore = { 'aidevpush.locale': 'zh-CN' };
    const sessionStore = {};
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
      async availability(options) {
        const lang = options
          && options.expectedInputs
          && options.expectedInputs[0]
          && options.expectedInputs[0].languages
          && options.expectedInputs[0].languages[0];
        if (lang === 'zh' || lang === 'zh-CN') return 'unavailable';
        return 'available';
      },
      async create() {
        return { inputQuota: 9216, destroy() {} };
      },
    };
    window.chrome = {
      runtime: {
        getManifest: () => ({ version: '1.8.170', content_scripts: [{ js: [] }] }),
        getURL: (p) => p,
        sendMessage: async () => ({ success: true, which: 'builtin' }),
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
        async query() { return [{ id: 1 }]; },
        sendMessage: async () => {},
        onActivated: { addListener() {} },
      },
      sidePanel: { onOpened: { addListener() {} } },
    };
  });
}

test.describe('侧栏本机模型 i18n', () => {
  test('已就绪时状态行收起，配额仍能探测', async ({ page }) => {
    await installStub(page);
    await page.goto(SIDEPANEL_URL);
    await page.locator('[data-testid=sp-tab-builtin]').click();
    await expect(page.locator('#spBuiltinRefresh')).toHaveCount(0);
    await expect(page.locator('#pageAdvisorWaterfallBuiltin')).toHaveCount(0);
    await expect(page.locator('#spBuiltinQuota')).toHaveText('9216', { timeout: 15000 });
    const status = page.locator('#spBuiltinStatus');
    await expect(status).toBeHidden();
    await expect(status).not.toHaveText('paBuiltinReady');
    await expect(status).not.toContainText('内置模型已就绪');
  });
});
