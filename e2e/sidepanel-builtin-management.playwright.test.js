/**
 * 侧栏「本机模型」管理面板浏览器级冒烟（OPT-20261002-012）
 *
 * 覆盖该条目剩余未闭环的两点（可见性/浅色层已由 sidepanel-builtin-light-layer
 * 与 sidepanel-builtin-status-i18n 锁定，此处不重复）：
 *  (1) 页签往返切换：「本机模型」与「设置」互相隐藏/显示，aria-selected 同步翻转
 *  (2) runtime session 刷新文案：chrome.storage.session 中 `pageAdvisorBuiltinRuntime`
 *      变化即重绘 `#spBuiltinStatus`（下载中百分比 / 已就绪收起 / 不可用）
 *
 * 全程 mock LanguageModel，不触发真实模型下载。
 *
 * 运行：bash e2e/sidepanel-builtin-management.playwright.test.js.sh
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
const SIDEPANEL_URL = pathToFileURL(path.join(__dirname, '..', 'sidepanel', 'sidepanel.html')).href;
const RUNTIME_KEY = 'pageAdvisorBuiltinRuntime';

/**
 * chrome.* + LanguageModel 桩：LanguageModel 一律报 downloadable，避免任何真实下载。
 * @param {import('@playwright/test').Page} page
 * @param {'create'|'settings'|'builtin'|'agent'} [openIntent] 侧栏打开时后台声明的页签
 */
async function installStub(page, openIntent = 'settings') {
  await page.addInitScript((intent) => {
    try { localStorage.setItem('aidevpush.locale', 'zh-CN'); } catch (_) { /* ignore */ }
    const localStore = { 'aidevpush.locale': 'zh-CN' };
    const sessionStore = {};
    const listeners = [];
    const fire = (bag, name) => {
      const changes = {};
      Object.keys(bag).forEach((k) => { changes[k] = { newValue: bag[k] }; });
      listeners.forEach((fn) => fn(changes, name));
    };
    const area = (store, name) => ({
      async get(keys) {
        if (typeof keys === 'string') return { [keys]: store[keys] };
        const list = Array.isArray(keys) ? keys : Object.keys(store);
        const out = {};
        for (const k of list) out[k] = store[k];
        return out;
      },
      async set(obj) {
        Object.assign(store, obj);
        fire(obj, name);
      },
    });
    window.LanguageModel = {
      async availability() { return 'downloadable'; },
      async create() { return { inputQuota: 9216, destroy() {} }; },
    };
    window.chrome = {
      runtime: {
        getManifest: () => ({ version: '1.8.170', content_scripts: [{ js: [] }] }),
        getURL: (p) => p,
        sendMessage: async () => ({ success: true, which: intent }),
        onMessage: { addListener() {} },
        lastError: null,
        id: 'test-ext',
      },
      storage: {
        local: area(localStore, 'local'),
        session: area(sessionStore, 'session'),
        onChanged: {
          addListener(fn) { listeners.push(fn); },
          removeListener(fn) {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
          },
        },
      },
      tabs: {
        async query() { return [{ id: 1 }]; },
        sendMessage: async () => {},
        onActivated: { addListener() {} },
      },
      sidePanel: { onOpened: { addListener() {} } },
    };
  }, openIntent);
}

/** 写入 storage.session 的 runtime 快照，模拟后台会话状态推进。 */
async function publishRuntime(page, snapshot) {
  await page.evaluate(({ key, snap }) => chrome.storage.session.set({ [key]: snap }), {
    key: RUNTIME_KEY,
    snap: snapshot,
  });
}

test.describe('侧栏本机模型管理', () => {
  test('「本机模型」与「设置」页签往返切换时显隐与 aria-selected 同步', async ({ page }) => {
    await installStub(page);
    await page.goto(SIDEPANEL_URL);

    const builtinPane = page.locator('#sp-pane-builtin');
    const settingsPane = page.locator('#sp-pane-settings');
    const builtinTab = page.locator('#sp-tab-builtin');
    const settingsTab = page.locator('#sp-tab-settings');

    // 侧栏壳默认停在「设置」页签
    await expect(settingsPane).toBeVisible();
    await expect(builtinPane).toBeHidden();
    await expect(settingsTab).toHaveAttribute('aria-selected', 'true');
    await expect(builtinTab).toHaveAttribute('aria-selected', 'false');

    // 去「本机模型」
    await builtinTab.click();
    await expect(builtinPane).toBeVisible({ timeout: 15000 });
    await expect(settingsPane).toBeHidden();
    await expect(builtinTab).toHaveAttribute('aria-selected', 'true');
    await expect(settingsTab).toHaveAttribute('aria-selected', 'false');

    // 回「设置」
    await settingsTab.click();
    await expect(settingsPane).toBeVisible();
    await expect(builtinPane).toBeHidden();
    await expect(settingsTab).toHaveAttribute('aria-selected', 'true');
    await expect(builtinTab).toHaveAttribute('aria-selected', 'false');

    // 再去「本机模型」：页签只隐藏不卸载，面板仍在同一文档内
    await builtinTab.click();
    await expect(builtinPane).toBeVisible();
    await expect(page.locator('#spBuiltinPanel')).toHaveCount(1);
  });

  test('后台声明 builtin 打开意图时侧栏直接落在「本机模型」页签', async ({ page }) => {
    await installStub(page, 'builtin');
    await page.goto(SIDEPANEL_URL);

    await expect(page.locator('#sp-pane-builtin')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#sp-pane-settings')).toBeHidden();
    await expect(page.locator('#sp-tab-builtin')).toHaveAttribute('aria-selected', 'true');
  });

  test('runtime session 快照变化即刷新状态行文案，就绪后收起', async ({ page }) => {
    await installStub(page);
    await page.goto(SIDEPANEL_URL);
    await page.locator('#sp-tab-builtin').click();

    const status = page.locator('#spBuiltinStatus');
    // 探测收敛后的基线：downloadable → 「尚未下载」提示（证明探测已完成，后续断言只由 storage 驱动）
    await expect(status).toContainText('内置模型尚未下载', { timeout: 15000 });

    // 下载中：百分比来自 storage 快照，探测路径不可能产出 37
    await publishRuntime(page, { availability: 'downloading', downloadPct: 37, downloadInFlight: true });
    await expect(status).toContainText('正在下载内置模型 37%');

    // 就绪：收起状态行
    await publishRuntime(page, { availability: 'available' });
    await expect(status).toBeHidden();
    await expect(status).toHaveText('');

    // 再次不可用：状态行重新出现（证明可反复刷新，不是一次性的）
    await publishRuntime(page, { availability: 'unavailable' });
    await expect(status).toBeVisible();
    await expect(status).toContainText('内置模型不可用');
  });
});
