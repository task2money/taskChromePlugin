/**
 * OAuth2+PKCE 登录全链路 E2E（OPT-20260808-024 阶段 2）
 *
 * 覆盖：真实扩展加载 → popup 发起 oauthStart → taskAuth 授权页（生产 www.aidevpush.com）
 * → 测试账号网页登录 → 302 回跳 oauth-callback.html → SW token 交换 + userinfo
 * → 单账号持久化 → getAuthStatus loggedIn → Bearer JWT 实际 API 调用 200 → logout 清理。
 *
 * 运行（需要完整 chromium + 显示服务器）：
 *   bash e2e/oauth-pkce-login.playwright.test.js.sh
 *
 * 依赖生产 OIDC 可用（/api/oidc/authorize|token|userinfo）+ 测试账号。CI 中
 * 生产网络不可达时跳过（opt-in），pre-commit 仍回退 real-extension-messaging。
 */

const fs = require('fs');
const path = require('path');

function loadPlaywrightTest() {
  try {
    return require('@playwright/test');
  } catch (_) {
    return require(path.resolve(__dirname, '../../AiDevGrafana/node_modules/@playwright/test'));
  }
}

const { test, expect } = loadPlaywrightTest();

const ROOT = path.resolve(__dirname, '..');
const EXT_PATH = ROOT;
const T = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE_URL = process.env.OAUTH_E2E_BASE_URL || 'https://www.aidevpush.com';
const EMAIL = process.env.OAUTH_E2E_EMAIL || 'ljy124818167@qq.com';
const PASSWORD = process.env.OAUTH_E2E_PASSWORD || 'rgNodkdq8677!ci';

test.describe('OAuth2+PKCE 登录全链路', () => {
  test('popup 发起授权 → 网页登录 → 回跳回调 → Bearer 调用 200 → logout', async () => {
    test.setTimeout(180_000);

    const manifest = JSON.parse(fs.readFileSync(path.join(EXT_PATH, 'manifest.json'), 'utf8'));
    expect(manifest.web_accessible_resources.some((w) => w.resources.includes('oauth-callback.html')),
      'oauth-callback.html 必须注册 web_accessible_resources（否则 302 回跳被 Chrome 拦截）').toBe(true);

    const { chromium } = loadPlaywrightTest();
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    try {
      // ---- 0. 预登录：网页登录获取会话 cookie ----
      // 这样 authorize 请求已登录 → 直接 302 code 回跳，不依赖 taskAuth 未登录
      // next 同域修复（OPT-20260808-024 taskAuth 侧 ba21f96，部署验证见 OPT-029）。
      const web = await context.newPage();
      await web.goto(`${BASE_URL}/auth/login/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await web.getByPlaceholder('邮箱').first().waitFor({ timeout: 30000 }).catch(async () => {
        await web.goto(`${BASE_URL}/auth/login/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      });
      await web.getByPlaceholder('邮箱').first().fill(EMAIL);
      await web.getByPlaceholder('密码').first().fill(PASSWORD);
      for (const tid of ['login-privacy-accept', 'login-license-accept']) {
        const cb = web.locator(`[data-testid="${tid}"]`);
        if (await cb.count()) { try { await cb.check(); } catch (_) { /* 已勾选 */ } }
      }
      await web.getByRole('button', { name: '登录', exact: true }).click();
      await web.waitForURL((u) => !u.toString().includes('/auth/login/'), { timeout: 60000 });

      // ---- 1. SW 启动 ----
      let sw = null;
      for (let i = 0; i < 20 && !sw; i++) {
        sw = context.serviceWorkers()[0] || null;
        if (!sw) await T(500);
      }
      expect(sw, '扩展 Service Worker 应启动').toBeTruthy();
      const extId = new URL(sw.url()).hostname;

      // ---- 2. popup 打开（chrome-extension 页直接导航）----
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
      await popup.waitForSelector('#loginSection', { state: 'visible', timeout: 10000 });

      const baseUrlInput = popup.locator('#baseUrl');
      await baseUrlInput.fill(BASE_URL);
      await popup.locator('#btnLogin').click();

      // 3. authorize 请求（已登录 → 302 code 回跳 callback，不再经过登录页）
      // oauthStart 通过 chrome.tabs.create 打开新 tab；token 交换完成后 callback 页被 SW 关闭，
      // 故轮询允许页面短暂存在或已被关闭两种情况
      let callbackSeen = false;
      for (let i = 0; i < 40 && !callbackSeen; i++) {
        callbackSeen = context.pages().some((p) => p.url().startsWith(`chrome-extension://${extId}/oauth-callback.html`));
        if (!callbackSeen) await T(500);
      }
      expect(callbackSeen, '已登录时 authorize 应 302 code 回跳 oauth-callback.html').toBe(true);
      const callbackPage = context.pages().find((p) => p.url().startsWith(`chrome-extension://${extId}/oauth-callback.html`)) || null;
      if (callbackPage) {
        await callbackPage.waitForSelector('#result', { timeout: 30000 });
        await callbackPage.waitForFunction(
          () => /登录成功/.test(document.getElementById('result')?.textContent || ''),
          { timeout: 30000 },
        );
      }

      // ---- 6. 登录态验证：getAuthStatus loggedIn + storage 单账号 ----
      // SW→SW sendMessage 不路由（MV3 限制），从 popup 页发起
      const status = await popup.evaluate(() => new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (resp) => resolve(resp));
      }));
      expect(status && status.success).toBe(true);
      expect(status.data.loggedIn, `SW 应登录：${JSON.stringify(status.data).slice(0, 300)}`).toBe(true);
      expect(status.data.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/); // RS256 JWT
      expect(status.data.username).not.toBe('');
      expect(status.data.userId).not.toBe('');

      // ---- 7. Bearer JWT 实际 API 调用（fetchCurrentUser → /api/user/<id>/accounts/users/me/）----
      const me = await sw.evaluate(async () => {
        try {
          const u = await API.fetchCurrentUser();
          return { ok: true, userId: u && u.id, username: u && u.username };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      });
      expect(me.ok, `Bearer JWT 调用应 200：${JSON.stringify(me)}`).toBe(true);
      expect(me.userId).toBeTruthy();

      // ---- 8. logout 清理（不留登录态污染后续 e2e）----
      await popup.evaluate(() => new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'logout' }, (resp) => resolve(resp));
      }));
      const afterLogout = await popup.evaluate(() => new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (resp) => resolve(resp));
      }));
      expect(afterLogout.data.loggedIn).toBe(false);
    } finally {
      await context.close().catch(() => {});
    }
  });
});
