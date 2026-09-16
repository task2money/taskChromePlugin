/**
 * Alt+Z（页面优化建议）状态完整播报与工具栏可访问名 — 端到端 a11y 树验收
 *
 * 对应 OPT-20260915-019：源码契约测（断言 HTML 字符串里带 aria-atomic）
 * 无法证明浏览器实际把整句播报出去。本用例改用 Playwright 的
 * role/accessible-name 查询（等价于读屏消费的 a11y 树计算），断言：
 * 1. 采集态 status 节点 role/aria-live/aria-atomic 齐全且整句可播报；
 * 2. 完成态 status 整句为「已生成 N 条优化建议」（非数字碎片）；
 * 3. 操作栏可访问名 = 优化建议操作栏；
 * 4. 填入按钮可访问名与 title 同时可达（读屏 + 悬停两条路径）。
 *
 * 驱动路径为真实的 SW→content 消息：`{action:'pageAdvisorResult'}`，
 * 与 background 回推结果的通道一致（content.js onMessage 分发）。
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

/** 与 manifest content_scripts[0].js 对齐的最小可启动链（含 page advisor） */
const LIB_FILES = [
  'lib/content-boot-gate.js',
  'lib/storage.js',
  'lib/dom-trace.js',
  'lib/create-task-git-identity.js',
  'lib/branch-datalist.js',
  'lib/create-task-payload.js',
  'lib/element-picker.js',
  'lib/plugin-brand.js',
  'lib/user-guide.js',
  'lib/float-workspace-select.js',
  'lib/workspace-list.js',
  'lib/workspace-members.js',
  'lib/float-members-ui.js',
  'lib/project-auto-run-label.js',
  'lib/workspace-auto-schedule.js',
  'lib/float-panel-markup.js',
  'lib/float-panel-after-create.js',
  'lib/aidev-meta.js',
  'lib/hot-path-guards.js',
  'lib/visibility-interval.js',
  'lib/auth-refresh-debounce.js',
  'lib/page-context.js',
  'lib/page-advisor-region.js',
  'lib/page-advisor-a11y.js',
  'lib/page-advisor-fill.js',
  'lib/page-advisor-preview.js',
  'lib/page-advisor-defaults.js',
  'lib/page-advisor-card-layout.js',
  'lib/float-last-selection.js',
  'lib/click-guard.js',
  'lib/is-auth-route.js',
  'lib/dialog-focus-trap.js',
  'content/float-boot.js',
  'content/float-pick.js',
  'content/float-drag-auth.js',
  'content/float-aidev.js',
  'content/float-form.js',
  'content/float-snapshot.js',
  'content/float-page-advisor-region.js',
  'content/float-page-advisor-layer.js',
  'content/float-page-advisor-drag.js',
  'content/float-page-advisor.js',
  'content/content.js',
];

/** 与 manifest content_scripts[0].css 对齐 */
const CSS_FILES = [
  'content/content.css',
  'content/content-form.css',
  'content/page-advisor.css',
  'content/content-region.css',
  'content/content-guide.css',
];

function installChromeStubs() {
  return `
    window.__onMessageHandlers = [];
    window.__storageOnChangedListeners = [];
    window.__sentMessages = [];
    window.chrome = {
      runtime: {
        sendMessage: async (msg, cb) => {
          window.__sentMessages.push(msg);
          let data = { loggedIn: true, token: 't', baseUrl: 'https://aidevpush.com' };
          // 浮球默认开启：否则 #taskplugin-float-root 为 display:none，
          // 建议层整棵子树不进 a11y 树，role 查询会全部落空。
          if (msg && msg.action === 'getFloatBallConfig') data = { enabled: true };
          if (msg && msg.action === 'pageOptimizationSuggest') data = { ok: true };
          const resp = { success: true, data };
          if (typeof cb === 'function') cb(resp);
          return resp;
        },
        onMessage: {
          addListener(fn) { window.__onMessageHandlers.push(fn); },
        },
        lastError: null,
      },
      storage: {
        local: {
          _store: {
            floatBallEnabled: true,
            trackingEnabled: false,
            workspaceId: 'ws_test',
            tenantId: '1',
          },
          async get(keys) {
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const k of list) out[k] = this._store[k];
            return out;
          },
          async set(obj) { Object.assign(this._store, obj); },
          async remove() {},
        },
        session: { async get() { return {}; }, async set() {} },
        onChanged: { addListener(fn) { window.__storageOnChangedListeners.push(fn); } },
      },
      dom: { openOrClosedShadowRoot() { return null; } },
    };
  `;
}

async function loadPluginIntoPage(page) {
  await page.addInitScript(installChromeStubs());
  await page.goto('about:blank');
  await page.evaluate(() => {
    document.body.innerHTML = `
      <h1 id="host-title">Host Page Title</h1>
      <p id="host-para">HOST_PAGE_TEXT_UNIQUE</p>
    `;
  });
  for (const rel of LIB_FILES) {
    await page.addScriptTag({ path: path.join(ROOT, rel) });
  }
  for (const rel of CSS_FILES) {
    await page.addStyleTag({ path: path.join(ROOT, rel) });
  }
  await page.waitForSelector('#taskplugin-float-btn', { state: 'attached', timeout: 15000 });
}

/**
 * 走真实 SW→content 通道投递结果消息（等价 chrome.tabs.sendMessage
 * → content.js onMessage 分发到 handlePageAdvisorResultMessage）。
 */
async function dispatchAdvisorResult(page, msg) {
  await page.evaluate((payload) => {
    const handlers = window.__onMessageHandlers || [];
    if (!handlers.length) throw new Error('content onMessage 未注册');
    for (const fn of handlers) fn({ action: 'pageAdvisorResult', ...payload }, {}, () => {});
  }, msg);
}

/** 复刻 SW 真实顺序：先 phase=loading，再 ok+phase=done 回推结果 */
async function finishWithSuggestions(page, suggestions) {
  await dispatchAdvisorResult(page, { phase: 'loading' });
  await dispatchAdvisorResult(page, { ok: true, phase: 'done', suggestions });
}

test.describe('Alt+Z 页面优化建议 a11y 播报', () => {
  test('采集态：status 节点整句可播报且 aria-atomic', async ({ page }) => {
    await loadPluginIntoPage(page);
    // 与 background/sw-page-advisor.js:109 的真实回推载荷逐字对齐
    await dispatchAdvisorResult(page, {
      ok: true,
      phase: 'loading',
      message: '正在采集页面并生成优化建议…',
    });

    const live = page.locator('#taskplugin-page-advisor-live');
    await expect(live).toHaveAttribute('role', 'status');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(live).toHaveAttribute('aria-atomic', 'true');
    // aria-atomic 的意义：整句一次播报，而不是逐字/逐节点
    await expect(live).toHaveText('正在采集页面并生成优化建议…');

    // 读屏消费的是 a11y 树里的可访问名/文本，而不是 HTML 源码字符串
    await expect(page.getByRole('status').filter({
      hasText: '正在采集页面并生成优化建议',
    }).first()).toBeAttached();
    // 可见的采集态卡片同样带 role=status，确保非 sr-only 路径也可播报
    await expect(page.locator('.taskplugin-page-advisor-status-card')
      .filter({ hasText: '正在采集页面并生成优化建议' })).toBeVisible();
  });

  test('完成态：整句「已生成 N 条优化建议」按 role=status 可达', async ({ page }) => {
    await loadPluginIntoPage(page);
    await finishWithSuggestions(page, [
      { id: 's1', title: '建议一', summary: '摘要一' },
      { id: 's2', title: '建议二', summary: '摘要二' },
      { id: 's3', title: '建议三', summary: '摘要三' },
    ]);

    const live = page.locator('#taskplugin-page-advisor-live');
    await expect(live).toHaveText('已生成 3 条优化建议');
    await expect(live).toHaveAttribute('aria-atomic', 'true');
  });

  test('空结果：播报「未返回可用建议」而非 0 条', async ({ page }) => {
    await loadPluginIntoPage(page);
    await finishWithSuggestions(page, []);

    await expect(page.locator('#taskplugin-page-advisor-live'))
      .toHaveText('未返回可用建议');
  });

  test('操作栏与填入按钮：可访问名 + title 双路径可达', async ({ page }) => {
    await loadPluginIntoPage(page);
    await finishWithSuggestions(page, [
      { id: 's1', title: '建议一', summary: '摘要一' },
    ]);

    const toolbar = page.getByRole('toolbar', { name: '优化建议操作栏' });
    await expect(toolbar).toHaveCount(1);

    const fillOne = toolbar.getByRole('button', { name: '逐条填入任务描述' });
    await expect(fillOne).toHaveCount(1);
    await expect(fillOne).toHaveAttribute(
      'title',
      '逐条把建议文案写入任务描述输入框，需手动提交',
    );

    const fillAll = toolbar.getByRole('button', { name: '全部填入任务描述' });
    await expect(fillAll).toHaveCount(1);
    await expect(fillAll).toHaveAttribute(
      'title',
      '将全部建议追加写入任务描述输入框，保留已有内容',
    );

    await expect(toolbar.getByRole('button', { name: '关闭预览并撤销改动' }))
      .toHaveCount(1);
  });

  test('失败态：role=alert 且 data-traceId 可提取', async ({ page }) => {
    await loadPluginIntoPage(page);
    await dispatchAdvisorResult(page, {
      ok: false,
      error: '页面优化建议超时',
      traceId: 'trace-abc-123',
    });

    const err = page.getByRole('alert').filter({ hasText: '页面优化建议超时' });
    await expect(err).toHaveCount(1);
    await expect(err).toHaveAttribute('data-traceId', 'trace-abc-123');
  });
});
