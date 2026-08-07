/**
 * 真实扩展消息通道 + panel 消息管道回归测试（Playwright）
 *
 * 与既有 e2e（file:// + mock chrome）不同，本测试通过 --load-extension 加载真实扩展，
 * 覆盖 file:// 测试无法捕获的两类缺陷：
 * 1. manifest 缺 "alarms" 权限 → SW 顶层 chrome.alarms.onAlarm 抛 TypeError → SW 启动失败
 *    → 扩展 runtime 消息通道双向全断（所有 sendMessage 超时，如 content.js getAuthStatus）
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

const ROOT = path.resolve(__dirname, '..');
const EXT_PATH = ROOT;
const T = (ms) => new Promise((r) => setTimeout(r, ms));

test.describe('真实扩展：SW 消息通道与 panel 消息管道', () => {
  test('manifest alarms 权限 + 双向消息往返 + panel 无 CSP 拦截 + 请求列表渲染', async () => {
    test.setTimeout(120_000);

    // ---- 0. manifest 静态断言：alarms 权限必须存在 ----
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT_PATH, 'manifest.json'), 'utf8'));
    expect(manifest.permissions, 'manifest 必须声明 alarms 权限（缺权限 → SW 顶层 TypeError → 消息通道全断）')
      .toContain('alarms');

    const { chromium } = loadPlaywrightTest();
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: false, // 扩展加载需要完整 chromium（非 headless shell）
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

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

      // ---- 2. SW 上下文：chrome.alarms 就绪 + 主 listener 注册 ----
      const swState = await sw.evaluate(() => ({
        hasAlarms: typeof chrome.alarms !== 'undefined',
        hasMainListener: chrome.runtime.onMessage.hasListeners(),
        runtimeId: chrome.runtime.id,
      }));
      expect(swState.hasAlarms, 'SW 上下文 chrome.alarms 应可用').toBe(true);
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
        }, '*');
      });
      await expect(page.locator('.request-item')).toHaveCount(1, { timeout: 10_000 });
      await expect(page.locator('.request-item')).toContainText('api.example.com/real');

      // ---- 6. SW 无 chrome.alarms TypeError，账号过期检测已启动 ----
      expect(swErrors.filter((e) => e.includes('alarms')), `SW console 不应有 alarms 相关错误：${swErrors.join('; ')}`)
        .toHaveLength(0);
      expect(swLogs.some((l) => l.includes('账号过期检测已启动')), '账号过期检测应启动（alarms 生效）').toBe(true);
    } finally {
      await context.close();
    }
  });
});
