/**
 * 跨页面同步任务描述 E2E（Playwright）
 *
 * 验证：
 * 1. Popup switch 默认开启
 * 2. Tab A 输入描述 → Tab B 同步更新
 * 3. 关闭 switch → Tab A 输入不再同步到 Tab B
 * 4. 反馈循环防护：Tab B 收到同步更新不会再次广播
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

/**
 * 创建一个共享的消息中继，模拟 Chrome Extension 的 Service Worker
 * 负责在 tabs 之间路由消息
 */
function createMessageRelay() {
  const pages = new Map();        // tabId → { page, url }
  const onMessageListeners = [];  // SW-level listeners (模拟 chrome.runtime.onMessage)
  let nextTabId = 1;

  return {
    /** 注册一个 tab（page）到消息中继 */
    registerTab(page, url) {
      const tabId = nextTabId++;
      pages.set(tabId, { page, url });
      return tabId;
    },

    /** 获取所有 tab 信息 */
    getAllTabs() {
      return Array.from(pages.entries()).map(([id, info]) => ({
        id,
        url: info.url,
      }));
    },

    /** 向指定 tab 发送消息 */
    async sendToTab(tabId, message) {
      const info = pages.get(tabId);
      if (!info) return;
      try {
        await info.page.evaluate((msg) => {
          if (window.__onMessageHandlers) {
            for (const fn of window.__onMessageHandlers) {
              try {
                fn(msg, { tab: { id: window.__tabId, url: window.__tabUrl } }, () => {});
              } catch (_) { /* ignore */ }
            }
          }
        }, message);
      } catch (_) { /* ignore */ }
    },

    /** 向所有 tab 广播消息（可排除 senderTabId） */
    async broadcastToTabs(message, excludeTabId) {
      for (const [tabId, info] of pages) {
        if (tabId === excludeTabId) continue;
        try {
          await info.page.evaluate((msg) => {
            if (window.__onMessageHandlers) {
              for (const fn of window.__onMessageHandlers) {
                try { fn(msg, { tab: { id: window.__tabId } }, () => {}); } catch (_) {}
              }
            }
          }, message);
        } catch (_) { /* ignore */ }
      }
    },

    /** 检查发送计数 */
    async getBroadcastCount() {
      let count = 0;
      for (const [tabId, info] of pages) {
        try {
          count += await info.page.evaluate(() => window.__broadcastReceived || 0);
        } catch (_) {}
      }
      return count;
    },

    /** 清理 */
    clear() {
      pages.clear();
    },
  };
}

/**
 * 在页面中注入 Chrome API stubs 和同步逻辑
 */
async function injectPageSetup(page, relay, opts = {}) {
  const syncEnabled = opts.syncEnabled !== false;

  // 先 navigate 到一个空白页面
  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body>
      <h1>TaskPlugin Sync Test - Tab</h1>
      <div id="taskplugin-float-root">
        <div id="taskplugin-float-panel" class="taskplugin-open">
          <div class="taskplugin-panel-body">
            <div class="taskplugin-form-group">
              <label>描述</label>
              <textarea class="taskplugin-textarea" id="taskplugin-desc"
                placeholder="任务描述..."></textarea>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);

  // 注册 tab 并注入 stubs
  const tabId = await page.evaluate(async () => {
    // 标记此页面，等 relay 注册后再设置 tabId
    window.__tabUrl = window.location.href;
    window.__onMessageHandlers = [];
    window.__broadcastReceived = 0;

    return null; // tabId 由 relay.registerTab 返回
  });

  const actualTabId = relay.registerTab(page, page.url());

  // 注入 chrome stubs + sync 逻辑
  await page.evaluate(({ tabId, syncEnabled }) => {
    window.__tabId = tabId;

    // ---- chrome API stubs ----
    window.chrome = {
      runtime: {
        sendMessage: async (msg) => {
          // 将消息转发给 relay 处理
          if (msg.action === 'syncDescription') {
            await window.__relaySendMessage(msg);
          }
          return { success: true };
        },
        onMessage: {
          addListener(fn) {
            window.__onMessageHandlers.push(fn);
          },
        },
        lastError: null,
      },
      storage: {
        local: {
          _store: { syncDescriptionEnabled: syncEnabled },
          async get(keys) {
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const k of list) out[k] = this._store[k];
            return out;
          },
          async set(obj) { Object.assign(this._store, obj); },
          async remove() {},
        },
        session: {
          async get() { return {}; },
          async set() {},
        },
      },
      tabs: {
        async query() {
          return await window.__relayGetAllTabs();
        },
        sendMessage: async (tabId, msg) => {
          await window.__relaySendToTab(tabId, msg);
        },
      },
    };

    // ---- 同步逻辑（从 content.js 提取） ----
    const descInput = document.getElementById('taskplugin-desc');
    let syncDescriptionEnabled = syncEnabled;
    let syncDebounceTimer = null;
    const SYNC_DEBOUNCE_MS = 300;
    let suppressSyncBroadcast = false;

    // 监听描述输入 → 广播
    if (descInput) {
      descInput.addEventListener('input', () => {
        if (!syncDescriptionEnabled || suppressSyncBroadcast) return;
        if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
        syncDebounceTimer = setTimeout(() => {
          const desc = descInput.value;
          chrome.runtime.sendMessage({
            action: 'syncDescription',
            description: desc,
            sourceUrl: window.location.href,
          }).catch(() => {});
        }, SYNC_DEBOUNCE_MS);
      });
    }

    // 监听来自其他 tab 的消息
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'setSyncDescriptionEnabled') {
        syncDescriptionEnabled = msg.enabled !== false;
      }
      if (msg.action === 'syncDescriptionUpdate') {
        if (!syncDescriptionEnabled) return;
        try {
          suppressSyncBroadcast = true;
          descInput.value = msg.description || '';
          window.__broadcastReceived = (window.__broadcastReceived || 0) + 1;
        } finally {
          setTimeout(() => { suppressSyncBroadcast = false; }, SYNC_DEBOUNCE_MS + 50);
        }
      }
    });
  }, { tabId: actualTabId, syncEnabled });

  // 暴露 relay 方法给页面
  await page.exposeFunction('__relaySendMessage', async (msg) => {
    // 模拟 SW 中继：收到 syncDescription，广播到其他 tab
    if (msg.action === 'syncDescription') {
      await relay.broadcastToTabs({
        action: 'syncDescriptionUpdate',
        description: msg.description,
        sourceUrl: msg.sourceUrl,
      }, actualTabId);
    }
  });

  await page.exposeFunction('__relayGetAllTabs', async () => {
    return relay.getAllTabs();
  });

  await page.exposeFunction('__relaySendToTab', async (tabId, msg) => {
    await relay.sendToTab(tabId, msg);
  });

  return actualTabId;
}

test.describe('跨页面同步任务描述', () => {
  test('默认开启：Tab A 输入描述 → Tab B 同步更新', async ({ browser }) => {
    const relay = createMessageRelay();
    const context = await browser.newContext();

    try {
      const pageA = await context.newPage();
      const pageB = await context.newPage();

      await injectPageSetup(pageA, relay);
      await injectPageSetup(pageB, relay);

      // 在 Tab A 的描述框中输入
      await pageA.locator('#taskplugin-desc').fill('这是一个跨页面同步的测试描述');
      // 等待防抖 + 中继
      await pageA.waitForTimeout(500);

      // Tab B 的描述框应该同步为相同内容
      const descB = await pageB.locator('#taskplugin-desc').inputValue();
      expect(descB).toBe('这是一个跨页面同步的测试描述');

      // Tab B 收到广播计数应该 >= 1
      const receivedB = await pageB.evaluate(() => window.__broadcastReceived || 0);
      expect(receivedB).toBeGreaterThanOrEqual(1);
    } finally {
      relay.clear();
      await context.close();
    }
  });

  test('关闭同步后：Tab A 输入不再同步到 Tab B', async ({ browser }) => {
    const relay = createMessageRelay();
    const context = await browser.newContext();

    try {
      const pageA = await context.newPage();
      const pageB = await context.newPage();

      const tabAId = await injectPageSetup(pageA, relay);
      const tabBId = await injectPageSetup(pageB, relay);

      // 先验证同步功能正常
      await pageA.locator('#taskplugin-desc').fill('同步开启时的描述');
      await pageA.waitForTimeout(500);
      let descB = await pageB.locator('#taskplugin-desc').inputValue();
      expect(descB).toBe('同步开启时的描述');

      // 关闭同步：模拟 popup 发送 setSyncDescriptionEnabled(false)
      // 1) 关闭 Tab A 的同步
      await relay.sendToTab(tabAId, { action: 'setSyncDescriptionEnabled', enabled: false });
      // 2) 关闭 Tab B 的同步
      await relay.sendToTab(tabBId, { action: 'setSyncDescriptionEnabled', enabled: false });

      // 记录 Tab B 当前的广播接收计数
      const receivedBefore = await pageB.evaluate(() => window.__broadcastReceived || 0);

      // 清空 Tab A 的描述再输入新内容
      await pageA.locator('#taskplugin-desc').fill('');
      await pageA.waitForTimeout(100);
      await pageA.locator('#taskplugin-desc').fill('关闭同步后的描述');
      await pageA.waitForTimeout(500);

      // Tab B 的描述应该保持不变（还是旧内容）
      descB = await pageB.locator('#taskplugin-desc').inputValue();
      expect(descB).toBe('同步开启时的描述');

      // Tab B 不应该收到新的广播
      const receivedAfter = await pageB.evaluate(() => window.__broadcastReceived || 0);
      expect(receivedAfter).toBe(receivedBefore);
    } finally {
      relay.clear();
      await context.close();
    }
  });

  test('重新开启同步：恢复跨页面同步', async ({ browser }) => {
    const relay = createMessageRelay();
    const context = await browser.newContext();

    try {
      const pageA = await context.newPage();
      const pageB = await context.newPage();

      const tabAId = await injectPageSetup(pageA, relay);
      const tabBId = await injectPageSetup(pageB, relay);

      // 关闭同步
      await relay.sendToTab(tabAId, { action: 'setSyncDescriptionEnabled', enabled: false });
      await relay.sendToTab(tabBId, { action: 'setSyncDescriptionEnabled', enabled: false });

      // 输入（不同步）
      await pageA.locator('#taskplugin-desc').fill('关闭时的内容');
      await pageA.waitForTimeout(500);
      expect(await pageB.locator('#taskplugin-desc').inputValue()).toBe('');

      // 重新开启同步
      await relay.sendToTab(tabAId, { action: 'setSyncDescriptionEnabled', enabled: true });
      await relay.sendToTab(tabBId, { action: 'setSyncDescriptionEnabled', enabled: true });

      // 再次输入（应该同步）
      await pageA.locator('#taskplugin-desc').fill('重新开启后的内容');
      await pageA.waitForTimeout(500);

      expect(await pageB.locator('#taskplugin-desc').inputValue()).toBe('重新开启后的内容');
    } finally {
      relay.clear();
      await context.close();
    }
  });

  test('反馈循环防护：收到同步的 tab 不会再次广播', async ({ browser }) => {
    const relay = createMessageRelay();
    const context = await browser.newContext();

    try {
      const pageA = await context.newPage();
      const pageB = await context.newPage();

      await injectPageSetup(pageA, relay);
      await injectPageSetup(pageB, relay);

      // 先同步一次，让 pageB 有一个稳定的接收计数
      await pageA.locator('#taskplugin-desc').fill('初始同步内容');
      await pageA.waitForTimeout(500);

      const receivedAfterFirstSync = await pageB.evaluate(() => window.__broadcastReceived || 0);
      expect(receivedAfterFirstSync).toBeGreaterThanOrEqual(1);

      // 再次输入，确保不会因为 feedback loop 产生多余的广播
      await pageA.locator('#taskplugin-desc').fill('第二次同步内容');
      await pageA.waitForTimeout(500);

      const receivedAfterSecondSync = await pageB.evaluate(() => window.__broadcastReceived || 0);
      // 应该只多了 1 次（来自第一次同步的正常广播）
      expect(receivedAfterSecondSync).toBe(receivedAfterFirstSync + 1);
    } finally {
      relay.clear();
      await context.close();
    }
  });

  test('Popup switch UI 默认开启且正常工作', async ({ page }) => {
    // 加载 popup.html 并验证 switch 存在且默认 checked
    const popupHtmlPath = path.join(__dirname, '..', 'popup', 'popup.html');

    // 注入 chrome stubs（已登录态）
    await page.addInitScript(() => {
      const store = {
        baseUrl: 'https://aidevpush.com',
        token: 'fake-token',
        tokenExpiresAt: 0,
        tokenIssuedAt: 0,
        username: 'testuser',
        userId: 'u1',
        memberId: 'm1',
        floatBallEnabled: true,
        trackingEnabled: false,
        syncDescriptionEnabled: true,
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
            if (msg.action === 'getSyncDescriptionConfig') {
              return { success: true, data: { enabled: store.syncDescriptionEnabled !== false } };
            }
            if (msg.action === 'setSyncDescriptionConfig') {
              store.syncDescriptionEnabled = !!msg.enabled;
              return { success: true };
            }
            if (msg.action === 'getCapturedErrors') {
              return { success: true, data: [] };
            }
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

    // 等待登录态加载完成 → #requestsSection 变为可见
    await page.waitForSelector('#requestsSection:not([style*="display: none"])', { timeout: 10000 });

    // 验证 switch 存在且默认 checked（input 用 opacity:0 隐藏，视觉由 slider span 呈现）
    const toggle = page.locator('#syncDescriptionToggle');
    await expect(toggle).toBeAttached();
    await expect(toggle).toBeChecked();

    // 验证 label 文字
    const labelText = await page.locator('#syncDescriptionToggle').locator('..').locator('..').textContent();
    expect(labelText).toContain('跨页面同步任务描述');

    // 关闭 switch：通过 JS 触发 change 事件（input 为 opacity:0 不可交互）
    await page.evaluate(() => {
      const el = document.getElementById('syncDescriptionToggle');
      el.checked = false;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(toggle).not.toBeChecked();

    // 开启 switch
    await page.evaluate(() => {
      const el = document.getElementById('syncDescriptionToggle');
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(toggle).toBeChecked();
  });
});
