/**
 * Popup 面板布局 E2E（Playwright）
 *
 * 加载真实 popup.html + popup.js，注入最小 chrome.* stub（未登录态）：
 * - 断言面板宽度收窄（body ≤ 300px，快捷键说明区不需要那么宽）
 * - 断言快捷键说明默认收起（#shortcutsBody 不可见）
 * - 点击「展开」→ 显示快捷键列表；再点「收起」→ 隐藏（点击后再展开）
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

const POPUP_HTML = path.join(__dirname, '..', 'popup', 'popup.html');
const POPUP_URL = pathToFileURL(POPUP_HTML).href;

/** 最小 stub：未登录态（getAuthStatus 无 token → showLoginUI → 快捷键区可见但折叠） */
async function installChromeStub(page) {
  await page.addInitScript(() => {
    const store = {
      baseUrl: 'https://aidevpush.com',
      token: '',
      tokenExpiresAt: 0,
      tokenIssuedAt: 0,
      username: '',
      userId: '',
      memberId: '',
    };
    const area = {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) out[k] = store[k];
        return out;
      },
      async set(obj) { Object.assign(store, obj); },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) delete store[k];
      },
    };
    window.chrome = {
      runtime: {
        sendMessage: async (msg) => {
          if (msg?.action === 'getAuthStatus') {
            return {
              success: true,
              data: {
                baseUrl: store.baseUrl, token: store.token,
                tokenExpiresAt: store.tokenExpiresAt, tokenIssuedAt: store.tokenIssuedAt,
                username: store.username, userId: store.userId, memberId: store.memberId,
                expired: false, loggedIn: !!store.token,
                remainingSeconds: store.token ? Infinity : -1, expiryHint: null,
              },
            };
          }
          return { success: true };
        },
        lastError: null,
      },
      storage: { local: area, session: { async get() { return {}; }, async set() {} } },
      tabs: { async query() { return []; }, sendMessage: async () => {} },
    };
  });
}

test.describe('Popup 面板布局', () => {
  test('面板宽度收窄至 300px 内（快捷键说明区不需要那么宽）', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);
    await expect(page.locator('#shortcutsSection')).toBeVisible({ timeout: 10000 });
    const width = await page.evaluate(() => document.body.getBoundingClientRect().width);
    expect(width).toBeLessThanOrEqual(300);
  });

  test('快捷键说明默认收起，点击「展开」后显示，再点「收起」恢复隐藏', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);

    const toggle = page.locator('#btnToggleShortcuts');
    const body = page.locator('#shortcutsBody');
    await expect(toggle).toBeVisible({ timeout: 10000 });
    await expect(toggle).toHaveText('展开');
    // 初始折叠：快捷键内容不可见
    await expect(body).toBeHidden();
    await expect(page.locator('#btnPickShortcutEdit')).toBeHidden();

    // 点击展开 → 内容可见，按钮变「收起」
    await toggle.click();
    await expect(body).toBeVisible();
    await expect(page.locator('#btnPickShortcutEdit')).toBeVisible();
    await expect(toggle).toHaveText('收起');

    // 再点收起 → 恢复隐藏
    await toggle.click();
    await expect(body).toBeHidden();
    await expect(toggle).toHaveText('展开');
  });
});
