/**
 * 侧栏「本机模型」页签必须落在浅色层：popup.css 的深色 .section 底（#252536）
 * 不得漏到 #sp-pane-builtin / #spBuiltinPanel（靠 popup-sidepanel.css 覆盖）。
 *
 * 运行：bash e2e/sidepanel-builtin-light-layer.playwright.test.js.sh
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

const DARK_SECTION = 'rgb(37, 37, 54)'; // popup.css .section { background: #252536 }
const DARK_BASE = 'rgb(30, 30, 46)'; // popup.css body { background: #1e1e2e }
const WHITE = 'rgb(255, 255, 255)';

// 白底上的可读前景：三通道都不过半亮度。
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
      async availability() { return 'available'; },
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

test.describe('侧栏本机模型浅色层', () => {
  test('切到本机模型页签后计算底色为白而非深色块', async ({ page }) => {
    await installStub(page);
    await page.goto(SIDEPANEL_URL);
    await page.locator('[data-testid=sp-tab-builtin]').click();

    const pane = page.locator('#sp-pane-builtin');
    await expect(pane).toBeVisible({ timeout: 15000 });

    const paneBg = await pane.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(paneBg, '#sp-pane-builtin 应为白底').toBe(WHITE);

    const panel = page.locator('#spBuiltinPanel');
    const panelBg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(panelBg, '#spBuiltinPanel 不得继承 popup.css 深色 .section 底').not.toBe(DARK_SECTION);
    expect(panelBg, '#spBuiltinPanel 不得继承深色基线').not.toBe(DARK_BASE);
    expect(panelBg, '#spBuiltinPanel 应为白底').toBe(WHITE);

    // 白底上的标题/hint 应为深字（对比度抽检）。
    const h3Color = await page.locator('#spBuiltinPanel h3').evaluate((el) => getComputedStyle(el).color);
    const hintColor = await page.locator('#spBuiltinStatus').evaluate((el) => getComputedStyle(el).color);
    expect(isDarkInk(h3Color), `#spBuiltinPanel h3 应为深字，实际 ${h3Color}`).toBe(true);
    expect(isDarkInk(hintColor), `#spBuiltinStatus 应为深字，实际 ${hintColor}`).toBe(true);
  });
});
