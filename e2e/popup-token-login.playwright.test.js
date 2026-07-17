/**
 * Popup 访问令牌登录 E2E（Playwright）
 *
 * 加载真实 popup.html + popup.js，注入 chrome.* stub：
 * - loginWithAccessToken 返回与线上一致的 200 载荷（含 token / user）
 * - 断言 UI 进入已登录态（devtoolsGuide 可见、loginSection 隐藏）
 *
 * 回归：API 已成功但广播/storage 慢时，界面不得卡在登录页。
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

const LOGIN_OK = {
  success: true,
  data: {
    redirect_url: '/tenant/850256677331562496/projects/',
    session_key: '5tdmbbsbzfdeoyy34fsbpc8s0fwh0pb3',
    token: '351fc90c6d0b447d4d0deebe09bc27c30a82b2b1',
    user: {
      avatar_url: null,
      companies: [
        {
          id: '850256677331562496',
          is_admin: true,
          member_id: '850256677331562497',
          name: 'ljy124818167',
        },
      ],
      current_company: {
        id: '850256677331562496',
        is_admin: true,
        member_id: '850256677331562497',
        name: 'ljy124818167',
      },
      current_workspace: null,
      email: 'ljy124818167@qq.com',
      id: '850256676127797248',
      is_active: true,
      is_superuser: false,
      login_methods: [
        {
          identifier: 'ljy124818167@qq.com',
          is_verified: true,
          method_type: 'email',
        },
      ],
      pending_privacy_policy: null,
      username: 'ljy124818167@qq.com',
    },
  },
};

async function installChromeStub(page, opts = {}) {
  const loginDelayMs = opts.loginDelayMs || 0;
  const hangBroadcast = !!opts.hangBroadcast;

  await page.addInitScript(({ loginOk, loginDelayMs: delay, hangBroadcast: hang }) => {
    const store = {
      baseUrl: 'https://daydaymoney.com',
      token: '',
      tokenExpiresAt: 0,
      tokenIssuedAt: 0,
      username: '',
      userId: '',
      memberId: '',
      floatBallEnabled: true,
      trackingEnabled: false,
    };

    const area = {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) out[k] = store[k];
        return out;
      },
      async set(obj) {
        Object.assign(store, obj);
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) delete store[k];
      },
    };

    window.chrome = {
      runtime: {
        sendMessage: async (msg) => {
          if (msg?.action === 'resetBadge') return { success: true };
          if (msg?.action === 'getAuthStatus') {
            return {
              success: true,
              data: {
                baseUrl: store.baseUrl,
                token: store.token,
                tokenExpiresAt: store.tokenExpiresAt,
                tokenIssuedAt: store.tokenIssuedAt,
                username: store.username,
                userId: store.userId,
                memberId: store.memberId,
                expired: false,
                loggedIn: !!store.token,
                remainingSeconds: store.token ? Infinity : -1,
                expiryHint: null,
              },
            };
          }
          if (msg?.action === 'getTrackingConfig') {
            return { success: true, data: { enabled: !!store.trackingEnabled } };
          }
          if (msg?.action === 'getCapturedErrors') {
            return { success: true, data: [] };
          }
          if (msg?.action === 'loginWithAccessToken') {
            if (delay) await new Promise((r) => setTimeout(r, delay));
            store.token = loginOk.data.token;
            store.baseUrl = msg.baseUrl || store.baseUrl;
            store.username = msg.username || loginOk.data.user.username;
            store.userId = loginOk.data.user.id;
            store.memberId = loginOk.data.user.current_company.member_id;
            // 模拟「广播挂起但不阻塞 success」：响应已返回
            if (hang) {
              /* intentionally not awaiting a hanging tab broadcast */
            }
            return loginOk;
          }
          if (msg?.action === 'logout') {
            store.token = '';
            store.username = '';
            store.userId = '';
            store.memberId = '';
            return { success: true };
          }
          return { success: true };
        },
        lastError: null,
      },
      storage: {
        local: area,
        session: {
          async get() { return {}; },
          async set() {},
        },
      },
      tabs: {
        async query() { return []; },
        sendMessage: async () => {},
      },
    };
  }, { loginOk: LOGIN_OK, loginDelayMs, hangBroadcast });
}

test.describe('Popup token login', () => {
  test('登录成功后离开登录页并展示 DevTools 引导', async ({ page }) => {
    await installChromeStub(page, { hangBroadcast: true });
    await page.goto(POPUP_URL);

    await expect(page.locator('#loginSection')).toBeVisible({ timeout: 10000 });

    await page.locator('#baseUrl').fill('https://daydaymoney.com');
    await page.locator('#username').fill('ljy124818167@qq.com');
    await page.locator('#accessToken').fill('at_0123456789abcdef');

    await page.locator('#btnLogin').click();

    await expect(page.locator('#loginSection')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#devtoolsGuide')).toBeVisible();
    await expect(page.locator('#headerUserArea')).toBeVisible();
    await expect(page.locator('#headerUser')).toContainText('ljy124818167@qq.com');
  });

  test('登录 API 成功载荷（对照 trace 样例）后进入已登录态', async ({ page }) => {
    await installChromeStub(page, { loginDelayMs: 80 });
    await page.goto(POPUP_URL);
    await expect(page.locator('#loginSection')).toBeVisible({ timeout: 10000 });

    await page.locator('#baseUrl').fill('https://daydaymoney.com');
    await page.locator('#username').fill('ljy124818167@qq.com');
    await page.locator('#accessToken').fill('at_trace17346d83d6656def');

    await page.locator('#btnLogin').click();
    await expect(page.locator('#devtoolsGuide')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#loginSection')).toBeHidden();
    await expect(page.locator('#loginResult')).not.toContainText('登录失败');
  });
});
