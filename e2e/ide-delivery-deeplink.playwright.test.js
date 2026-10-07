/**
 * IDE 送达深链 E2E（Playwright）
 *
 * 覆盖 OPT-20261007-003（Alt+X IDE 送达冒烟）与 OPT-20261007-007
 * （Alt+Z IDE 目标「生成后不自动转发」）两款单测锁不到的「真浏览器」行为：
 * 在真实 page 里加载 content 送达链 + SW 送达处理器，用 mock 的
 * `chrome.runtime.sendMessage` 把二者接通，并以 `chrome.tabs.create`
 * 记录实际发起的深链。node 单测只逐段静态断言，无法证明
 * 「content → SW handler → buildIdeDeeplink → tabs.create → 状态回显」整链。
 *
 * 加载顺序刻意对齐 manifest：
 *   lib/page-advisor-delivery.js（纯函数：目标归一 / 深链 / 状态文案）
 *   lib/page-advisor-fill.js（建议块格式化）
 *   content/float-page-advisor-deliver.js（content 侧送达入口）
 *   background/sw-page-advisor-delivery.js（SW 侧处理器）
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

const SCRIPTS = [
  'lib/page-advisor-delivery.js',
  'lib/page-advisor-fill.js',
  'content/float-page-advisor-deliver.js',
  'background/sw-page-advisor-delivery.js',
];

/**
 * 安装 chrome / navigator / i18n / showResult stub。
 * 关键：runtime.sendMessage 把 deliverPageAdvisorToIde 路由到
 * 真实 SW 处理器 handleDeliverPageAdvisorToIde（脚本加载后才存在）。
 */
function installStubs() {
  return `
    window.__tabsCreated = [];
    window.__tabsConfig = { fail: false };
    window.__nativeConfig = { action: 'lastError', message: 'host_missing' };
    window.__clipboardWrites = [];
    window.__toasts = [];
    window.__deliveryTarget = 'task_description';
    window.pageAdvisorState = { suggestions: [], pageUrl: '', jobId: '' };

    // i18n：IDE 显示名（ideDisplayName 用它把键翻成名称）+ 状态文案插值
    window.tx = function (key, params) {
      var table = {
        paDeliveryCursor: 'Cursor',
        paDeliveryClaude: 'Claude',
        paDeliveryCodex: 'Codex',
        paDeliveryTaskDesc: '任务描述',
        paDeliverDeeplinkOk: '已打开 {name} 并填入建议',
        paDeliverNativeOk: '已发送到 {name}',
        paDeliverClipboardOnly: '已复制，请在 {name} 粘贴',
        paDeliverClipboardFail: '未能复制建议，请检查剪贴板权限后重试',
        paDeliverAppNotRunning: '未检测到 {name} 在运行，建议已复制',
        paDeliverAgainAll: '发送到 {name}',
        paDeliverAgainOne: '发送一条到 {name}',
      };
      var s = table[key] || key;
      if (params && params.name) s = s.replace('{name}', params.name);
      return s;
    };

    window.showResult = function (text, kind) {
      window.__toasts.push({ text: text, kind: kind });
    };

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async function (text) { window.__clipboardWrites.push(text); },
      },
    });

    window.chrome = {
      runtime: {
        lastError: null,
        sendMessage: async function (msg) {
          if (msg && msg.action === 'deliverPageAdvisorToIde'
              && typeof handleDeliverPageAdvisorToIde === 'function') {
            return await handleDeliverPageAdvisorToIde(msg);
          }
          return { success: true };
        },
        sendNativeMessage: function (host, payload, cb) {
          var cfg = window.__nativeConfig || {};
          if (cfg.action === 'lastError') {
            window.chrome.runtime.lastError = { message: cfg.message || 'host_missing' };
            cb(undefined);
            window.chrome.runtime.lastError = null;
            return;
          }
          cb(cfg.resp || { ok: false, error: 'host_missing' });
        },
      },
      storage: {
        local: {
          async get(keys, cb) {
            var out = { pageAdvisorDeliveryTarget: window.__deliveryTarget };
            if (typeof cb === 'function') { cb(out); return; }
            return out;
          },
          async set() {},
        },
      },
      tabs: {
        create(opts, cb) {
          if (window.__tabsConfig && window.__tabsConfig.fail) {
            window.chrome.runtime.lastError = { message: 'tabs_create_failed' };
            if (typeof cb === 'function') cb();
            window.chrome.runtime.lastError = null;
            return Promise.resolve({});
          }
          window.__tabsCreated.push(opts && opts.url);
          if (typeof cb === 'function') cb();
          return Promise.resolve({ id: window.__tabsCreated.length });
        },
      },
    };
  `;
}

async function loadDeliveryChain(page) {
  await page.addInitScript(installStubs());
  await page.goto('about:blank');
  await page.evaluate(`document.body.innerHTML = '<div id="host"></div>';`);
  for (const rel of SCRIPTS) {
    await page.addScriptTag({ path: path.join(ROOT, rel) });
  }
  // 加载后无任何自发深链：Alt+Z/Alt+X 之外不得自动打开 IDE
  expect(await page.evaluate('window.__tabsCreated.length')).toBe(0);
}

function setTarget(page, target) {
  return page.evaluate((t) => { window.__deliveryTarget = t; }, target);
}

test.describe('IDE 送达深链（content → SW → tabs.create）', () => {
  test('Alt+X 确认路径：Cursor 目标经整链发起 cursor:// 深链并回显状态', async ({ page }) => {
    await loadDeliveryChain(page);
    await setTarget(page, 'cursor');
    // native host 缺失（未装 IDE bridge）——纵深链仍应靠 deeplink 成功
    await page.evaluate(`window.__nativeConfig = { action: 'lastError', message: 'host_missing' };`);

    const outcome = await page.evaluate(
      `deliverPlainTextViaDeliveryTarget('fix login header', 'https://example.test/page')`,
    );
    expect(outcome.delivered).toBe(true);
    expect(outcome.target).toBe('cursor');
    expect(outcome.ok).toBe(true);
    expect(outcome.createTaskCalled).toBe(false);
    expect(outcome.openedPanel).toBe(false);

    const tabs = await page.evaluate('window.__tabsCreated');
    expect(tabs).toEqual([
      'cursor://anysphere.cursor-deeplink/prompt?text=' + encodeURIComponent('fix login header'),
    ]);
    // 剪贴板降级同时写入
    expect(await page.evaluate('window.__clipboardWrites')).toEqual(['fix login header']);
    // 状态文案含 IDE 名
    const toast = await page.evaluate('window.__toasts[window.__toasts.length - 1]');
    expect(toast.kind).toBe('success');
    expect(toast.text).toContain('Cursor');
  });

  test('任务描述目标：不发起深链、不写剪贴板，交回调用方写侧栏描述', async ({ page }) => {
    await loadDeliveryChain(page);
    await setTarget(page, 'task_description');

    const outcome = await page.evaluate(
      `deliverPlainTextViaDeliveryTarget('some text', 'https://example.test/page')`,
    );
    expect(outcome).toEqual({ delivered: false, target: 'task_description' });
    expect(await page.evaluate('window.__tabsCreated')).toEqual([]);
    expect(await page.evaluate('window.__clipboardWrites')).toEqual([]);
    expect(await page.evaluate('window.__toasts')).toEqual([]);
  });

  test('失败路径：IDE 未运行（native app_not_running）toast 含 IDE 名', async ({ page }) => {
    await loadDeliveryChain(page);
    await setTarget(page, 'cursor');
    // deeplink 打开失败 + native 报 app_not_running，但剪贴板成功
    await page.evaluate(`window.__tabsConfig = { fail: true };`);
    await page.evaluate(`window.__nativeConfig = { action: 'resp', resp: { ok: false, error: 'app_not_running' } };`);

    const outcome = await page.evaluate(
      `deliverPlainTextViaDeliveryTarget('x', 'https://example.test/page')`,
    );
    expect(outcome.delivered).toBe(true);
    expect(outcome.ok).toBe(true);
    expect(await page.evaluate('window.__tabsCreated')).toEqual([]);
    const toast = await page.evaluate('window.__toasts[window.__toasts.length - 1]');
    expect(toast.text).toContain('Cursor');
    expect(toast.text).toContain('未检测到');
  });

  test('Alt+X 全失败（剪贴板不可用）→ 错误 toast，不误报成功', async ({ page }) => {
    await loadDeliveryChain(page);
    await setTarget(page, 'codex');
    await page.evaluate(`window.__tabsConfig = { fail: true };`);
    await page.evaluate(`window.__nativeConfig = { action: 'lastError', message: 'host_missing' };`);
    // 剪贴板写入抛错 → clipboardOk=false
    await page.evaluate(`
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => { throw new Error('denied'); } },
      });
    `);

    const outcome = await page.evaluate(
      `deliverPlainTextViaDeliveryTarget('x', 'https://example.test/page')`,
    );
    expect(outcome.ok).toBe(false);
    const toast = await page.evaluate('window.__toasts[window.__toasts.length - 1]');
    expect(toast.kind).toBe('error');
    expect(toast.text).toContain('未能复制');
  });

  test('底栏「发送到 X」路径：显式触发前不建深链，触发后恰好一条', async ({ page }) => {
    await loadDeliveryChain(page);
    await setTarget(page, 'cursor');
    await page.evaluate(`
      window.pageAdvisorState = {
        suggestions: [{ id: 's1', title: '按钮靠左', detail: '改为左对齐', label: 'button#go' }],
        pageUrl: 'https://example.test/page',
        jobId: '',
      };
    `);
    // 底栏按钮文案应显示目标 IDE 名（applyPageAdvisorDeliveryButtonLabels）。
    // 该函数读的是 loadPageAdvisorDeliveryTarget 缓存，须先刷新缓存。
    const label = await page.evaluate(`
      (async function () {
        await loadPageAdvisorDeliveryTarget();
        const all = document.createElement('button');
        all.id = 'taskplugin-page-advisor-fill-all';
        const one = document.createElement('button');
        one.id = 'taskplugin-page-advisor-fill-one';
        document.body.appendChild(all); document.body.appendChild(one);
        applyPageAdvisorDeliveryButtonLabels(all, one);
        return all.textContent;
      })()
    `);
    expect(label).toBe('发送到 Cursor');

    // 生成/渲染本身不自动送达：显式调用前 0 条深链
    expect(await page.evaluate('window.__tabsCreated.length')).toBe(0);

    const outcome = await page.evaluate(
      `deliverPageAdvisorSuggestions({ mode: 'all', selectedIds: ['s1'] })`,
    );
    expect(outcome.filled).toBe(true);
    expect(outcome.createTaskCalled).toBe(false);
    const tabs = await page.evaluate('window.__tabsCreated');
    expect(tabs.length).toBe(1);
    expect(tabs[0]).toContain('cursor://anysphere.cursor-deeplink/prompt?text=');
    expect(decodeURIComponent(tabs[0].split('text=')[1])).toContain('页面优化建议');
  });

  test('shouldAutoDeliverOnResult 对全部 IDE 目标恒 false（真浏览器契约）', async ({ page }) => {
    await loadDeliveryChain(page);
    const flags = await page.evaluate(`({
      cursor: PageAdvisorDelivery.shouldAutoDeliverOnResult('cursor'),
      claude: PageAdvisorDelivery.shouldAutoDeliverOnResult('claude'),
      codex: PageAdvisorDelivery.shouldAutoDeliverOnResult('codex'),
      task: PageAdvisorDelivery.shouldAutoDeliverOnResult('task_description'),
    })`);
    expect(flags).toEqual({ cursor: false, claude: false, codex: false, task: false });
  });
});
