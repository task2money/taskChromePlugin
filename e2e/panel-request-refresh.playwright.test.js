/**
 * DevTools 面板请求列表「刷新」链路复现测试（Playwright）
 *
 * 真实加载 devtools.html + panel.html，mock chrome.devtools / chrome.runtime，
 * 验证：
 * 1. onRequestFinished 实时推送 → 面板列表追加
 * 2. 点击「🔄 刷新列表」→ 面板应能拉取到最新请求（不得只过滤本地内存）
 * 3. panel 与 devtools 内存不同步（消息丢失场景）时，刷新可自愈
 */

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

/** chrome API stubs：devtools 页（请求监听 + 面板创建）与 panel iframe 共用 */
function installChromeStubs() {
  return `
    window.__reqListeners = [];
    window.__navListeners = [];
    window.__panelCallbacks = [];
    window.__harEntries = [];
    window.__swRequests = [];      // service worker 侧的 devToolsRequests
    window.__onMessageHandlers = [];
    window.__lastRefreshFallback = null;
    window.__onShownListeners = [];

    window.makeEntryHack = (method, url, status, startedDateTime, extra) => ({
      startedDateTime,
      request: { method, url, headers: [], postData: undefined },
      response: { status, statusText: String(status), headers: [], content: { mimeType: 'application/json', text: '{}' } },
      time: 12,
      _resourceType: 'xhr',
      getContent(cb) { cb('{}', ''); },
      ...extra,
    });

    const sendMessageImpl = async (msg) => {
      if (!msg || !msg.action) return { success: false, error: 'no action' };
      if (msg.action === 'getAuthStatus') {
        return { success: true, data: { baseUrl: 'https://aidevpush.com', token: '', loggedIn: false, expired: false, tokenExpiresAt: 0, tokenIssuedAt: 0, remainingSeconds: 0, expiryHint: null } };
      }
      if (msg.action === 'ping') return { pong: true };
      if (msg.action === 'addRecentRequest') {
        if (msg.request) {
          window.__swRequests.push(msg.request);
          if (window.__swRequests.length > 500) window.__swRequests.splice(0, window.__swRequests.length - 500);
        }
        return { success: true };
      }
      if (msg.action === 'updateRecentRequest') {
        const req = msg.request;
        if (req && req.id) {
          const idx = window.__swRequests.findIndex((r) => r.id === req.id);
          if (idx >= 0) window.__swRequests[idx] = req;
          else if (req) window.__swRequests.push(req);
        }
        return { success: true };
      }
      if (msg.action === 'getRecentRequests') {
        window.__lastRefreshFallback = msg;
        return { success: true, data: [...window.__swRequests].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 200) };
      }
      if (msg.action === 'getEndpointMapping') return { success: true, data: {} };
      if (msg.action === 'getWorkspaces') return { success: true, data: [] };
      return { success: false, error: 'unhandled:' + msg.action };
    };

    window.chrome = {
      runtime: {
        sendMessage: async (msg) => sendMessageImpl(msg),
        onMessage: {
          addListener(fn) { window.__onMessageHandlers.push(fn); },
        },
        lastError: null,
      },
      storage: {
        local: {
          _store: {},
          async get(keys) {
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const k of list) out[k] = this._store[k];
            return out;
          },
          async set(obj) { Object.assign(this._store, obj); },
          async remove(keys) {
            const list = Array.isArray(keys) ? keys : [keys];
            for (const k of list) delete this._store[k];
          },
        },
      },
      devtools: {
        inspectedWindow: { tabId: 1 },
        network: {
          onRequestFinished: {
            addListener(fn) { window.__reqListeners.push(fn); },
          },
          onNavigated: {
            addListener(fn) { window.__navListeners.push(fn); },
          },
          getHAR: async () => ({ log: { entries: window.__harEntries } }),
        },
        panels: {
          create: (name, icon, pagePath, callback) => {
            window.__panelCallbacks.push(callback);
            const iframe = document.createElement('iframe');
            iframe.id = 'tcp-panel-frame';
            iframe.src = pagePath;
            document.body.appendChild(iframe);
            callback({
              onShown: {
                addListener(fn) { window.__onShownListeners.push(fn); },
              },
            });
          },
        },
      },
    };
  `;
}

test.describe('DevTools 面板请求列表刷新链路', () => {
  test('实时推送 + 刷新按钮从 SW 拉取最新请求', async ({ page }) => {
    await page.addInitScript(installChromeStubs());
    await page.goto('file://' + path.join(ROOT, 'devtools/devtools.html'));

    // 等待 devtools.js 初始化完成（panels.create 已调用，iframe 挂载）
    await page.waitForSelector('#tcp-panel-frame');
    await page.waitForFunction(() => window.__reqListeners.length === 1);

    // 模拟 onShown（把 iframe 的 contentWindow 交给 devtools.js）
    await page.evaluate(() => {
      const iframe = document.getElementById('tcp-panel-frame');
      for (const fn of window.__onShownListeners) fn(iframe.contentWindow);
    });

    // 等待 panel 完全加载
    const frame = page.frameLocator('#tcp-panel-frame');
    await frame.locator('#btnRefreshRequest').waitFor({ state: 'attached', timeout: 10000 });

    // 场景 1：实时推送两个请求 → 面板列表应追加
    await page.evaluate(() => {
      for (const fn of window.__reqListeners) fn(window.makeEntryHack('GET', 'https://api.example.com/a', 200, '2026-08-05T01:00:00.000Z'));
      for (const fn of window.__reqListeners) fn(window.makeEntryHack('POST', 'https://api.example.com/b', 201, '2026-08-05T01:00:01.000Z'));
    });

    await expect(frame.locator('.request-item')).toHaveCount(2, { timeout: 10000 });

    // 场景 2：模拟 panel 内存不同步（devtools 推送被清空 → 面板只收到空 init）
    await page.evaluate(() => {
      const iframe = document.getElementById('tcp-panel-frame');
      iframe.contentWindow.postMessage({ action: 'initRequests', requests: [] }, '*');
    });
    await expect(frame.locator('.request-item')).toHaveCount(0, { timeout: 10000 });

    // 再推送一个新请求到 SW 侧（模拟 devtools 捕获到但 panel 未收到）
    // 注意：真实扩展中 SW 是单例；此处 mock 的 SW 状态在 iframe 作用域内，
    // 因此在 iframe 上下文推送，保证刷新时能读到同一份 SW 数据。
    const panelFrame = page.frames().find((f) => f !== page.mainFrame());
    await panelFrame.evaluate(() => {
      const req = window.makeEntryHack('GET', 'https://api.example.com/c', 404, '2026-08-05T01:00:02.000Z');
      // 经 devtools.js 的 pushRequest 逻辑：newRequest 推送被跳过，仅 SW 侧 addRecentRequest
      window.chrome.runtime.sendMessage({ action: 'addRecentRequest', request: req });
    });

    // 点击「🔄 刷新列表」→ 修复后应从 SW 拉取最新请求并重新渲染
    await frame.locator('#btnRefreshRequest').click();
    await expect(frame.locator('.request-item')).toHaveCount(1, { timeout: 10000 });
    expect(await panelFrame.evaluate(() => window.__lastRefreshFallback?.action)).toBe('getRecentRequests');
  });
});
