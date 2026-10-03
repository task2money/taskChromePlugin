/**
 * 侧栏「设置」Tab iframe：展开使用说明后，指南展开区必须仍是白底深字。
 *
 * 覆盖 ID 选择器（#popup-user-guide .tcp-guide-body）曾被 popup-guide.css 深色块
 * 压过通配白底的回归——纯静态扫描测不出真实 iframe 层叠。
 *
 * 运行：bash e2e/sidepanel-settings-guide-light.playwright.test.js.sh
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

const WHITE = 'rgb(255, 255, 255)';

function isDarkInk(cssColor) {
  const nums = String(cssColor).match(/\d+/g);
  if (!nums || nums.length < 3) return false;
  const [r, g, b] = nums.slice(0, 3).map(Number);
  return r < 128 && g < 128 && b < 128;
}

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
      async set(obj) { Object.assign(store, obj); fire(obj, name); },
    });
    window.LanguageModel = {
      async availability() { return 'downloadable'; },
      async create() { return { inputQuota: 4096, destroy() {} }; },
    };
    window.chrome = {
      runtime: {
        getManifest: () => ({ version: '1.8.170' }),
        getURL: (p) => p,
        sendMessage: async () => ({ success: true }),
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
      tabs: { async query() { return [{ id: 1 }]; }, sendMessage: async () => {}, onActivated: { addListener() {} } },
      sidePanel: { onOpened: { addListener() {} } },
    };
  });
}

test.describe('侧栏设置 iframe 使用说明浅色层', () => {
  test('展开使用说明后 tcp-guide-body 与 .section 为白底深字', async ({ page }) => {
    await installStub(page);
    await page.goto(SIDEPANEL_URL);

    const frame = page.frameLocator('#sp-settings-frame');

    // popup-host.js 应据 ?host=sidepanel 给 iframe 根打上属性，浅色覆盖才生效。
    await expect
      .poll(async () => frame.locator('html').evaluate((el) => el.getAttribute('data-taskplugin-host')), { timeout: 15000 })
      .toBe('sidepanel');

    const toggle = frame.locator('[data-guide-toggle]');
    await expect(toggle).toBeVisible({ timeout: 15000 });
    await toggle.click();

    const body = frame.locator('.tcp-guide-body');
    await expect(body).toBeVisible({ timeout: 10000 });
    const bodyBg = await body.evaluate((el) => getComputedStyle(el).backgroundColor);
    const bodyColor = await body.evaluate((el) => getComputedStyle(el).color);
    expect(bodyBg, '.tcp-guide-body 应为白底').toBe(WHITE);
    expect(isDarkInk(bodyColor), `.tcp-guide-body 应为深字，实际 ${bodyColor}`).toBe(true);

    const section = frame.locator('.tcp-guide-section').first();
    const sectionBg = await section.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(sectionBg, '.tcp-guide-section 应为白底').toBe(WHITE);
  });
});
