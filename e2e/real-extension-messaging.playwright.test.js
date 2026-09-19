/**
 * 真实扩展消息通道 + panel 消息管道回归测试（Playwright）
 *
 * 与既有 e2e（file:// + mock chrome）不同，本测试通过 --load-extension 加载真实扩展，
 * 覆盖 file:// 测试无法捕获的两类缺陷：
 * 1. SW 启动失败 → 扩展 runtime 消息通道双向全断（所有 sendMessage 超时）
 *    （历史：缺 alarms 守卫曾 TypeError；现正式包无 alarms，须仍能启动）
 * 2. MV3 扩展页面 CSP (script-src 'self') 阻止 panel.html head 内联脚本
 *    → devtools postMessage relay 不生效 → 网络请求列表为空
 *
 * 运行（需要完整 chromium + 显示服务器）：
 *   bash e2e/real-extension-messaging.playwright.test.js.sh
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

const { launchExtensionContext } = require('./helpers/launchExtensionContext');

const ROOT = path.resolve(__dirname, '..');
const EXT_PATH = ROOT;
const T = (ms) => new Promise((r) => setTimeout(r, ms));

test.describe('真实扩展：SW 消息通道与 panel 消息管道', () => {
  test('manifest 无 alarms + 双向消息往返 + panel 无 CSP 拦截 + 请求列表渲染', async () => {
    test.setTimeout(120_000);

    // ---- 0. manifest 静态断言：权限瘦身禁止回潮 ----
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT_PATH, 'manifest.json'), 'utf8'));
    expect(manifest.permissions, '正式包不得声明 alarms（仅用时校验，无后台定时扫）')
      .not.toContain('alarms');
    expect(manifest.permissions, '正式包不得声明 cookies（OAuth 后无生产调用）')
      .not.toContain('cookies');
    expect(manifest.permissions, '正式包不得声明 activeTab（tabs + <all_urls> 已覆盖）')
      .not.toContain('activeTab');

    const { chromium } = loadPlaywrightTest();
    // OPT-20260918-027: 与 oauth-pkce e2e 统一走 launchExtensionContext
    // （优先缓存完整 chromium 的 executablePath，而非易抖的 channel:'chromium'）。
    const context = await launchExtensionContext(chromium, EXT_PATH, { headless: false });

    try {
      // ---- 1. 等待 SW 启动 ----
      let sw = null;
      for (let i = 0; i < 20 && !sw; i++) {
        sw = context.serviceWorkers()[0] || null;
        if (!sw) await T(500);
      }
      expect(sw, '扩展 Service Worker 应启动').toBeTruthy();
      const extId = new URL(sw.url()).hostname;

      const swErrors = [];
      const swLogs = [];
      sw.on('console', (m) => {
        if (m.type() === 'error') swErrors.push(m.text());
        swLogs.push(m.text());
      });

      // ---- 2. SW 主 listener 注册（无 alarms 权限时 chrome.alarms 应为 undefined）----
      const swState = await sw.evaluate(() => ({
        hasAlarms: typeof chrome.alarms !== 'undefined',
        hasMainListener: chrome.runtime.onMessage.hasListeners(),
        runtimeId: chrome.runtime.id,
      }));
      expect(swState.hasAlarms, '正式包无 alarms 权限时 SW 中 chrome.alarms 应为 undefined').toBe(false);
      expect(swState.hasMainListener, 'SW 主 onMessage listener 应已注册').toBe(true);
      expect(swState.runtimeId).toBe(extId);

      // ---- 3. 页面 → SW 双向消息往返 ----
      const page = await context.newPage();
      const pageCspErrors = [];
      page.on('console', (m) => {
        if (m.text().includes('Content Security Policy')) pageCspErrors.push(m.text());
      });
      await page.goto(`chrome-extension://${extId}/panel/panel.html`);

      // 3a. 页面 → SW ping（修复前 5s 超时；修复后应 < 1s）
      const t0 = Date.now();
      const pong = await page.evaluate(() => new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ action: 'ping' }, (resp) => {
            if (chrome.runtime.lastError) resolve({ lastError: chrome.runtime.lastError.message });
            else resolve(resp);
          });
        } catch (e) { resolve({ syncError: e.message }); }
      }));
      const pingMs = Date.now() - t0;
      expect(pingMs, `ping 往返应 < 1000ms，实际 ${pingMs}ms`).toBeLessThan(1000);
      expect(pong).toEqual({ pong: true });

      // 3b. 页面 → SW getAuthStatus（用户报障路径：5s 超时回退 Storage）
      const t1 = Date.now();
      const authStatus = await page.evaluate(() => new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (resp) => {
            if (chrome.runtime.lastError) resolve({ lastError: chrome.runtime.lastError.message });
            else resolve(resp);
          });
        } catch (e) { resolve({ syncError: e.message }); }
      }));
      const authMs = Date.now() - t1;
      expect(authMs, `getAuthStatus 应快速响应（修复前 5s 超时），实际 ${authMs}ms`).toBeLessThan(5000);
      expect(authStatus && authStatus.success, `getAuthStatus 应成功：${JSON.stringify(authStatus).slice(0, 200)}`).toBe(true);

      // 3c. SW → 页面反向消息
      await page.evaluate(() => {
        self.__swMsgHits = 0;
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
          if (msg && msg.action === '__swProbe') {
            self.__swMsgHits += 1;
            sendResponse({ gotIt: true, hit: self.__swMsgHits });
            return true;
          }
          return false;
        });
      });
      const reverse = await sw.evaluate(() => new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ action: '__swProbe' }, (resp) => {
            if (chrome.runtime.lastError) resolve({ lastError: chrome.runtime.lastError.message });
            else resolve(resp);
          });
        } catch (e) { resolve({ syncError: e.message }); }
      }));
      expect(reverse, `SW → 页面消息应往返：${JSON.stringify(reverse)}`).toEqual({ gotIt: true, hit: 1 });

      // ---- 4. panel 无 CSP 报错（head 内联脚本已移除，relay 在 panel.js 内注册）----
      expect(pageCspErrors, `panel.html 不应有 CSP 报错（内联脚本被阻止的回归信号）：${pageCspErrors.join('; ')}`)
        .toHaveLength(0);

      // ---- 5. 注入 devtools postMessage → 请求列表渲染 ----
      await page.evaluate(() => {
        window.postMessage({
          action: 'initRequests',
          requests: [{
            id: 'realtest-1', harKey: 'rt1', method: 'GET', url: 'https://api.example.com/real',
            statusCode: 200, statusText: 'OK', time: 10, timestamp: Date.now(),
          }],
        }, window.location.origin);
      });
      await expect(page.locator('.request-item')).toHaveCount(1, { timeout: 10_000 });
      await expect(page.locator('.request-item')).toContainText('api.example.com/real');

      // ---- 6. SW 无 alarms TypeError；不得启动后台过期定时扫 ----
      expect(swErrors.filter((e) => e.includes('alarms')), `SW console 不应有 alarms 相关错误：${swErrors.join('; ')}`)
        .toHaveLength(0);
      expect(swLogs.some((l) => l.includes('账号过期检测已启动')), '不得启动账号过期定时检测').toBe(false);
    } finally {
      await context.close();
    }
  });
});
