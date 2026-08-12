/**
 * DevTools 面板请求列表「清空列表」链路（Playwright）
 *
 * 验证：
 * 1. 「🗑️ 清空列表」按钮在「🔄 刷新列表」旁可见
 * 2. 有请求时点击清空 → 列表变空
 * 3. 再点「🔄 刷新列表」仍为空（SW 缓存已清，不得拉回）
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

function installChromeStubs() {
  return `
    window.__reqListeners = [];
    window.__navListeners = [];
    window.__panelCallbacks = [];
    window.__harEntries = [];
    window.__swRequests = [];
    window.__onMessageHandlers = [];
    window.__lastClearAction = null;
    window.__onShownListeners = [];

    window.makeEntryHack = (method, url, status, startedDateTime, extra) => ({
      id: method + '-' + url + '-' + startedDateTime,
      startedDateTime,
      timestamp: Date.parse(startedDateTime) || Date.now(),
      method,
      url,
      statusCode: status,
      statusText: String(status),
      time: 12,
      request: { method, url, headers: [], postData: undefined },
      response: { status, statusText: String(status), headers: [], content: { mimeType: 'application/json', text: '{}' } },
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
        return { success: true, data: [...window.__swRequests].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 200) };
      }
      if (msg.action === 'clearRecentRequests') {
        window.__lastClearAction = msg.action;
        window.__swRequests = [];
        for (const fn of window.__onMessageHandlers) {
          try { fn(msg, {}, () => {}); } catch (_) {}
        }
        return { success: true };
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

test.describe('DevTools 面板请求列表清空链路', () => {
  test('清空列表按钮清空 UI 且刷新不再拉回', async ({ page }) => {
    await page.addInitScript(installChromeStubs());
    await page.goto('file://' + path.join(ROOT, 'devtools/devtools.html'));

    await page.waitForSelector('#tcp-panel-frame');
    await page.waitForFunction(() => window.__reqListeners.length === 1);

    await page.evaluate(() => {
      const iframe = document.getElementById('tcp-panel-frame');
      for (const fn of window.__onShownListeners) fn(iframe.contentWindow);
    });

    const frame = page.frameLocator('#tcp-panel-frame');
    await frame.locator('#btnRefreshRequest').waitFor({ state: 'attached', timeout: 10000 });
    await expect(frame.locator('#btnClearRequestList')).toBeVisible();

    await page.evaluate(() => {
      for (const fn of window.__reqListeners) {
        fn(window.makeEntryHack('GET', 'https://api.example.com/a', 200, '2026-08-05T02:00:00.000Z'));
      }
      for (const fn of window.__reqListeners) {
        fn(window.makeEntryHack('POST', 'https://api.example.com/b', 500, '2026-08-05T02:00:01.000Z'));
      }
    });

    await expect(frame.locator('.request-item')).toHaveCount(2, { timeout: 10000 });

    await frame.locator('#btnClearRequestList').click();
    await expect(frame.locator('.request-item')).toHaveCount(0, { timeout: 10000 });
    await expect(frame.locator('#selectedRequest')).toContainText('暂无匹配的请求');

    const panelFrame = page.frames().find((f) => f !== page.mainFrame());
    expect(await panelFrame.evaluate(() => window.__swRequests.length)).toBe(0);
    expect(await panelFrame.evaluate(() => window.__lastClearAction)).toBe('clearRecentRequests');

    await frame.locator('#btnRefreshRequest').click();
    await expect(frame.locator('.request-item')).toHaveCount(0, { timeout: 10000 });
  });
});
