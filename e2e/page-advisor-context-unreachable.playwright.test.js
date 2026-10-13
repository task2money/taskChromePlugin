/**
 * 侧边栏「给当前网页生成建议」在页面联系不上 content script 时不是死胡同（回归）
 *
 * 用户报障：扩展在开发者模式下重载后，旧页面里 content script 已随旧扩展实例失效，
 * 点「给当前网页生成建议」只打出一行
 *   `getPageAdvisorContext frame0 失败，回退整 tab 广播: Could not establish connection.`
 * 没有任何网络请求，侧边栏也没有可执行的提示。
 *
 * 这类状态只有真实 Chrome 才造得出来（扩展重载不会给已打开页面重新注入 content script，
 * 页面 DOM 里的浮窗还在，看起来一切正常），故用真实扩展 + chrome://extensions 重载复现：
 * 1. 扩展重载前：采集正常（基线，证明后面不是「一律失败」）
 * 2. 重载后旧页面：直接采集与侧边栏消息路径都返回 PAGE_CONTEXT_UNREACHABLE +
 *    「刷新页面」文案，且不抛原始连接错误
 * 3. 重载后新开页面：采集正常（恢复只需刷新页面，分类没有误伤）
 *
 * 运行（需要完整 chromium + 显示服务器）：
 *   bash e2e/page-advisor-context-unreachable.playwright.test.js.sh
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
const { launchExtensionContext } = require('./helpers/launchExtensionContext');
const { startStaticServer } = require('./helpers/staticServer');

const EXT_PATH = path.resolve(__dirname, '..');
const T = (ms) => new Promise((r) => setTimeout(r, ms));
const REFRESH_HINT = /刷新|Refresh/;
const FLOAT_ROOT_SELECTOR = 'taskplugin-float-root';

/** 直连 LLM 配置：让路由守卫放行，把流程推到「采集页面上下文」这一步。 */
async function seedDirectLlmConfig(sw) {
  return sw.evaluate(async () => {
    await chrome.storage.local.set({
      pageAdvisorLlmApiKey: 'e2e-key',
      pageAdvisorLlmBaseUrl: 'http://127.0.0.1:1/v1',
      pageAdvisorLlmModel: 'e2e-model',
      pageAdvisorLlmRoute: 'direct',
    });
    const cfg = await PageAdvisorLlmConfig.loadFromStorage();
    return {
      route: PageAdvisorLlmConfig.resolveRoute(cfg),
      ready: PageAdvisorLlmConfig.isDirectLlmReady(cfg),
    };
  });
}

/** 等一个能真正调用 chrome API 的 SW（扩展重载会换实例，旧 target 会失效）。 */
async function waitForLiveSw(context, ms = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const workers = context.serviceWorkers();
    const sw = workers[workers.length - 1];
    if (sw) {
      try {
        if (await sw.evaluate(() => chrome.runtime.id)) return sw;
      } catch (_) { /* 旧实例 target 已关闭 */ }
    }
    await T(300);
  }
  return null;
}

/** 走开发者真实动作：chrome://extensions 里点「重新加载」。 */
async function reloadExtensionViaUi(context, extId) {
  const extPage = await context.newPage();
  await extPage.goto('chrome://extensions/');
  await T(1500);
  const out = await extPage.evaluate((id) => {
    const steps = [];
    const mgr = document.querySelector('extensions-manager');
    if (!mgr) return { ok: false, steps: steps.concat('no extensions-manager') };
    const toolbar = mgr.shadowRoot.querySelector('extensions-toolbar');
    const dev = toolbar && toolbar.shadowRoot.querySelector('#devMode');
    if (dev && !dev.checked) dev.click();
    const list = mgr.shadowRoot.querySelector('extensions-item-list');
    const items = list ? [...list.shadowRoot.querySelectorAll('extensions-item')] : [];
    const item = items.find((i) => i.id === id);
    const btn = item && item.shadowRoot.querySelector('#dev-reload-button');
    if (!btn) return { ok: false, steps: steps.concat(`reload button missing (items=${items.length})`) };
    btn.click();
    return { ok: true, steps };
  }, extId);
  await extPage.close();
  expect(out.ok, `chrome://extensions 重载失败：${JSON.stringify(out)}`).toBe(true);
}

async function tabIdFor(sw, urlFragment) {
  return sw.evaluate(async (frag) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => String(t.url || '').includes(frag));
    return tab ? tab.id : null;
  }, urlFragment);
}

/** 侧边栏按钮走的那条消息（sw-messages-task.js:213）。 */
async function sendGenerateFromExtensionPage(extPage) {
  return extPage.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'generateAgentSuggestionsForActiveTab', skillId: '', promptTendency: '' },
      (resp) => {
        if (chrome.runtime.lastError) resolve({ lastError: chrome.runtime.lastError.message });
        else resolve(resp);
      },
    );
  }));
}

test.describe('真实扩展：页面联系不上 content script 时的生成建议出口', () => {
  test('扩展重载后旧页面：给「刷新页面」文案与错误码，新页面不受影响', async () => {
    test.setTimeout(240_000);

    const { chromium } = loadPlaywrightTest();
    const srv = await startStaticServer();
    const context = await launchExtensionContext(chromium, EXT_PATH, { headless: false });
    const swLogs = [];
    const watchSw = (sw) => {
      if (!sw || typeof sw.on !== 'function') return;
      sw.on('console', (m) => swLogs.push(`${m.type()}: ${m.text()}`));
    };

    try {
      let sw = await waitForLiveSw(context);
      expect(sw, '扩展 Service Worker 应启动').toBeTruthy();
      watchSw(sw);
      const extId = new URL(sw.url()).hostname;

      const seeded = await seedDirectLlmConfig(sw);
      expect(seeded.ready, `直连配置应就绪（否则采集前的路由守卫会先返回）：${JSON.stringify(seeded)}`).toBe(true);

      // ---- 基线：正常页面采集成功 ----
      const page = await context.newPage();
      await page.goto(`${srv.baseURL}/popup/popup.html?advisorStale=1`);
      await page.waitForFunction(
        (sel) => !!document.getElementById(sel),
        FLOAT_ROOT_SELECTOR,
        { timeout: 20_000 },
      );
      const tabId = await tabIdFor(sw, 'advisorStale=1');
      expect(tabId, '应能定位到目标 tab').toBeTruthy();
      const before = await sw.evaluate((id) => askContentPageAdvisorContext(id), tabId);
      expect(before && before.success, `重载前采集应成功：${JSON.stringify(before)}`).toBe(true);

      // ---- 扩展重载（页面不刷新）：content script 随旧实例失效 ----
      await reloadExtensionViaUi(context, extId);
      sw = await waitForLiveSw(context);
      expect(sw, '重载后 SW 应重新起来').toBeTruthy();
      watchSw(sw);

      const extPage = await context.newPage();
      await extPage.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
      const tabIdAfter = await tabIdFor(sw, 'advisorStale=1');
      expect(tabIdAfter).toBe(tabId);
      // 页面看着「还活着」：浮窗 DOM 仍在，正是这个状态骗过了使用者。
      expect(await page.evaluate((sel) => !!document.getElementById(sel), FLOAT_ROOT_SELECTOR)).toBe(true);

      // 2a. 直接采集：返回分类后的失败对象，不抛原始连接错误
      const t0 = Date.now();
      const dead = await sw.evaluate((id) => askContentPageAdvisorContext(id), tabIdAfter);
      expect(dead && dead.success).toBe(false);
      expect(dead.errorCode, JSON.stringify(dead)).toBe('PAGE_CONTEXT_UNREACHABLE');
      expect(String(dead.error)).toMatch(REFRESH_HINT);
      expect(Date.now() - t0, '已加载完的页面应快速判死，不该长时间挂住').toBeLessThan(8000);

      // 2b. 侧边栏消息路径（用户报障的那条栈）：同样拿到可执行文案
      await page.bringToFront();
      const resp = await sendGenerateFromExtensionPage(extPage);
      expect(resp && resp.success).toBe(false);
      expect(resp.errorCode, JSON.stringify(resp)).toBe('PAGE_CONTEXT_UNREACHABLE');
      expect(String(resp.error)).toMatch(REFRESH_HINT);

      // 3. 恢复路径：重载后新开的页面采集正常
      const page2 = await context.newPage();
      await page2.goto(`${srv.baseURL}/popup/popup.html?advisorFresh=1`);
      await page2.waitForFunction(
        (sel) => !!document.getElementById(sel),
        FLOAT_ROOT_SELECTOR,
        { timeout: 20_000 },
      );
      const tabIdFresh = await tabIdFor(sw, 'advisorFresh=1');
      const after = await sw.evaluate((id) => askContentPageAdvisorContext(id), tabIdFresh);
      expect(after && after.success, `重载后新页面应正常：${JSON.stringify(after)}`).toBe(true);

      // 4. 诊断日志：结构化、带 tabId，且不带 query（可能含用户数据）
      const unreachableLog = swLogs.find((l) => l.includes('page_context_unreachable'));
      expect(unreachableLog, `SW 应有结构化诊断日志：${JSON.stringify(swLogs.slice(-10))}`).toBeTruthy();
      expect(unreachableLog).toContain(`tabId=${tabIdAfter}`);
      expect(unreachableLog).not.toContain('advisorStale=1');
    } finally {
      await context.close();
      await srv.close();
    }
  });
});
