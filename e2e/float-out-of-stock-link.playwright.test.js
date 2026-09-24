/**
 * 浮窗 × 无库存项目链接 E2E（Playwright）
 *
 * 背景：OPT-20260923-034。创建任务时硬件无库存，浮窗把项目名渲染成项目详情页链接。
 * 纯函数单测（test/create-task-hardware-stock.test.js）只覆盖 URL 与文案切分，
 * 看不到「样式把链接点不中」或「6 秒定时器把链接清掉」这类 DOM 回归。
 *
 * 验证（加载真实 lib 链 + content 脚本，直接驱动浮窗失败渲染）：
 * 1. 锚点 href = {origin}/tenant/{company}/projects/{id}/、target=_blank、rel=noopener
 * 2. 链接文字就是项目名，前后文案仍在（不是把整条错误替换成链接）
 * 3. 等 7 秒后错误区仍在、链接仍在（带链接的失败提示不挂 6 秒自动清除）
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

const ROOT = path.resolve(__dirname, '..');

/** 与 manifest.json content_scripts 相同的加载顺序，外加链接相关的两个 lib。 */
const LIB_FILES = [
  'lib/storage.js',
  'lib/dom-trace.js',
  'lib/create-task-git-identity.js',
  'lib/branch-datalist.js',
  'lib/create-task-payload.js',
  'lib/element-picker.js',
  'lib/user-guide.js',
  'lib/float-workspace-select.js',
  'lib/project-auto-run-label.js',
  'lib/workspace-auto-schedule.js',
  'lib/float-panel-markup.js',
  'lib/float-panel-after-create.js',
  'lib/aidev-meta.js',
  'lib/is-auth-route.js',
  'lib/task-detail-href.js',
  'lib/create-task-hardware-stock.js',
  'content/float-boot.js',
  'content/float-pick.js',
  'content/float-drag-auth.js',
  'content/float-form.js',
  'content/float-snapshot.js',
  'content/content.js',
];

/** 注入 chrome API stubs（必须在页面脚本之前） */
function installChromeStubs() {
  return `
    window.__onMessageHandlers = [];
    window.__storageOnChangedListeners = [];
    window.chrome = {
      runtime: {
        sendMessage: async (msg, cb) => {
          let data = {
            baseUrl: 'https://aidevpush.com',
            token: '',
            username: '',
            userId: '',
            memberId: '',
            expired: false,
            loggedIn: false,
            remainingSeconds: 0,
            expiryHint: null,
          };
          if (msg && msg.action === 'getFloatBallConfig') data = { enabled: true };
          const resp = { success: true, data };
          if (typeof cb === 'function') cb(resp);
          return resp;
        },
        onMessage: { addListener(fn) { window.__onMessageHandlers.push(fn); } },
        lastError: null,
      },
      storage: {
        local: {
          _store: { floatBallEnabled: true, trackingEnabled: false },
          async get(keys) {
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const k of list) out[k] = this._store[k];
            return out;
          },
          async set(obj) {
            const changes = {};
            for (const [k, v] of Object.entries(obj)) {
              changes[k] = { newValue: v, oldValue: this._store[k] };
              this._store[k] = v;
            }
            if (Object.keys(changes).length > 0) {
              for (const fn of window.__storageOnChangedListeners) {
                try { fn(changes, 'local'); } catch (_) {}
              }
            }
          },
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
  // 本环境 Playwright 的 addInitScript 在 setContent 文档上不生效，
  // 需先 goto 空白页（init script 会在该文档运行），再注入页面内容与脚本
  await page.addInitScript(installChromeStubs());
  await page.goto('about:blank');
  await page.evaluate(`document.body.innerHTML = '<h1>Out Of Stock Link Test</h1><p>content</p>';`);
  for (const rel of LIB_FILES) {
    await page.addScriptTag({ path: path.join(ROOT, rel) });
  }
  await page.waitForSelector('#taskplugin-float-btn', { state: 'attached', timeout: 10000 });
}

/** 浮窗创建失败：硬件无库存，携带项目定位信息。 */
const OUT_OF_STOCK_ERROR = {
  message: '项目「Alpha」暂无库存',
  code: 'HARDWARE_OUT_OF_STOCK',
  projectId: 'p1',
  companyId: 'ten-1',
  projectName: 'Alpha',
  traceId: 'trace-stock-link',
};

async function renderOutOfStockFailure(page) {
  return page.evaluate((err) => {
    const error = Object.assign(new Error(err.message), err);
    presentFloatCreateFailure(error, 'https://aidevpush.com');
    const div = document.getElementById('taskplugin-result');
    const anchor = div.querySelector('a');
    return {
      className: div.className,
      text: div.textContent,
      href: anchor ? anchor.getAttribute('href') : '',
      target: anchor ? anchor.getAttribute('target') : '',
      rel: anchor ? anchor.getAttribute('rel') : '',
      linkText: anchor ? anchor.textContent : '',
      hasTimer: Boolean(div._tcpClear),
    };
  }, OUT_OF_STOCK_ERROR);
}

test.describe('浮窗 × 无库存项目链接', () => {
  test('项目名渲染成项目详情链接且不被 6 秒定时器清掉', async ({ page }) => {
    await loadPluginIntoPage(page);
    const shown = await renderOutOfStockFailure(page);

    expect(shown.href).toBe('https://aidevpush.com/tenant/ten-1/projects/p1/');
    expect(shown.target).toBe('_blank');
    expect(shown.rel).toBe('noopener noreferrer');
    expect(shown.linkText).toBe('「Alpha」');
    // 链接前后仍保留错误文案，不是把整条提示换成链接
    expect(shown.text).toContain('创建失败');
    expect(shown.text).toContain('暂无库存');
    expect(shown.className).toContain('taskplugin-result-error');
    // 带链接的失败不挂自动清除定时器
    expect(shown.hasTimer).toBe(false);

    // 等过 6 秒清除窗口后链接仍在（回归点：定时器把可点的详情链接清掉）
    await page.waitForTimeout(7000);
    const after = await page.evaluate(() => {
      const div = document.getElementById('taskplugin-result');
      const anchor = div.querySelector('a');
      return {
        className: div.className,
        href: anchor ? anchor.getAttribute('href') : '',
        linkText: anchor ? anchor.textContent : '',
      };
    });
    expect(after.className).toContain('taskplugin-show');
    expect(after.href).toBe('https://aidevpush.com/tenant/ten-1/projects/p1/');
    expect(after.linkText).toBe('「Alpha」');
  });

  test('点击提示 × 只消除无库存提示，面板仍可继续填写', async ({ page }) => {
    await loadPluginIntoPage(page);
    await renderOutOfStockFailure(page);
    const dismissed = await page.evaluate(() => {
      const div = document.getElementById('taskplugin-result');
      const panel = document.getElementById('taskplugin-float-panel');
      if (panel) panel.classList.add('taskplugin-open');
      const btn = div.querySelector('button.taskplugin-result-dismiss');
      if (!btn) return { ok: false };
      btn.click();
      return {
        ok: true,
        className: div.className,
        childCount: div.childElementCount,
        panelOpen: panel ? panel.classList.contains('taskplugin-open') : false,
      };
    });
    expect(dismissed.ok).toBe(true);
    expect(dismissed.className).toBe('taskplugin-result');
    expect(dismissed.childCount).toBe(0);
    expect(dismissed.panelOpen).toBe(true);
  });

  test('非无库存失败仍显示纯文本并被定时器清除', async ({ page }) => {
    await loadPluginIntoPage(page);
    const plain = await page.evaluate(() => {
      presentFloatCreateFailure(new Error('查询硬件库存失败'), 'https://aidevpush.com');
      const div = document.getElementById('taskplugin-result');
      return {
        hasAnchor: Boolean(div.querySelector('a')),
        hasTimer: Boolean(div._tcpClear),
        text: div.textContent,
      };
    });
    expect(plain.hasAnchor).toBe(false);
    expect(plain.text).toContain('查询硬件库存失败');
    // 无链接的错误保留原有自动清除行为
    expect(plain.hasTimer).toBe(true);
  });
});
