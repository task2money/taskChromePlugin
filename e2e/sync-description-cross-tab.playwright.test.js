/**
 * 任务描述按标签页隔离（Playwright）
 *
 * 跨页面同步已下线：A 页填写不得覆盖 B 页；Popup 无同步开关。
 */

const path = require('path');

function loadPlaywrightTest() {
  try {
    return require('@playwright/test');
  } catch (_) {
    return require(path.resolve(__dirname, '../../task2app/playwright/node_modules/@playwright/test'));
  }
}

const { test, expect } = loadPlaywrightTest();

async function injectIsolatedDescPage(page) {
  await page.setContent(`
    <html><body>
      <textarea id="taskplugin-desc"></textarea>
    </body></html>
  `);
}

test.describe('任务描述按标签页隔离', () => {
  test('Tab A 输入不改变 Tab B', async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const pageA = await context.newPage();
      const pageB = await context.newPage();
      await injectIsolatedDescPage(pageA);
      await injectIsolatedDescPage(pageB);

      await pageA.locator('#taskplugin-desc').fill('仅 A 页描述');
      await pageB.waitForTimeout(400);

      expect(await pageB.locator('#taskplugin-desc').inputValue()).toBe('');
    } finally {
      await context.close();
    }
  });

  test('Popup 无跨页面同步开关', async ({ page }) => {
    const popupHtmlPath = path.join(__dirname, '..', 'popup', 'popup.html');

    await page.addInitScript(() => {
      const store = {
        baseUrl: 'https://aidevpush.com',
        token: 'fake-token',
        username: 'testuser',
        userId: 'u1',
        memberId: 'm1',
        floatBallEnabled: true,
        trackingEnabled: false,
      };
      window.chrome = {
        runtime: {
          sendMessage: async (msg) => {
            if (msg.action === 'resetBadge') return { success: true };
            if (msg.action === 'getAuthStatus') {
              return {
                success: true,
                data: {
                  baseUrl: store.baseUrl,
                  token: store.token,
                  tokenExpiresAt: 0,
                  tokenIssuedAt: 0,
                  username: store.username,
                  userId: store.userId,
                  memberId: store.memberId,
                  expired: false,
                  loggedIn: true,
                  remainingSeconds: Infinity,
                  expiryHint: null,
                },
              };
            }
            if (msg.action === 'getTrackingConfig') {
              return { success: true, data: { enabled: !!store.trackingEnabled } };
            }
            if (msg.action === 'getFloatBallConfig') {
              return { success: true, data: { enabled: !!store.floatBallEnabled } };
            }
            if (msg.action === 'getCapturedErrors') return { success: true, data: [] };
            return { success: true };
          },
          lastError: null,
        },
        storage: {
          local: {
            async get(keys) {
              const list = Array.isArray(keys) ? keys : [keys];
              const out = {};
              for (const k of list) out[k] = store[k];
              return out;
            },
            async set(obj) { Object.assign(store, obj); },
            async remove() {},
          },
          session: { async get() { return {}; }, async set() {} },
        },
        tabs: {
          async query() { return [{ id: 1 }, { id: 2 }]; },
          sendMessage: async () => {},
        },
      };
    });

    await page.goto('file://' + popupHtmlPath);
    await page.waitForSelector('#requestsSection:not([style*="display: none"])', { timeout: 10000 });

    await expect(page.locator('#syncDescriptionToggle')).toHaveCount(0);
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toContain('跨页面同步任务描述');
  });
});
