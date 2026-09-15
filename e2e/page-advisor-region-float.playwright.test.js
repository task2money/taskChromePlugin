/**
 * Alt+Shift+E：元素选择不被浮窗挡住（OPT-20260915-021）
 *
 * 当前 UX 为元素点选（非拖拽矩形）。验收：
 * 1. 打开浮窗后进入区域选择 → 面板收起
 * 2. hint 挂在 body（非 float-root）
 * 3. 点选宿主元素后 pending 采集不含浮窗文案（源码路径：setPendingPageAdvisorElements）
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

/** 与 manifest content_scripts[0].js 对齐的最小可启动链（含 region advisor） */
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

function installChromeStubs() {
  return `
    window.__onMessageHandlers = [];
    window.__storageOnChangedListeners = [];
    window.__sentMessages = [];
    window.chrome = {
      runtime: {
        sendMessage: async (msg, cb) => {
          window.__sentMessages.push(msg);
          let data = {
            baseUrl: 'https://aidevpush.com',
            token: 't',
            username: 'u',
            userId: '1',
            memberId: '',
            expired: false,
            loggedIn: true,
            remainingSeconds: 3600,
            expiryHint: null,
          };
          if (msg && msg.action === 'getAuthStatus') {
            data = { ...data, loggedIn: true, token: 't' };
          }
          if (msg && msg.action === 'getFloatBallConfig') {
            data = { enabled: true };
          }
          if (msg && msg.action === 'pageOptimizationSuggest') {
            data = { ok: true };
          }
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
          async set(obj) {
            Object.assign(this._store, obj);
          },
          async remove() {},
        },
        session: {
          async get() { return {}; },
          async set() {},
        },
        onChanged: {
          addListener(fn) { window.__storageOnChangedListeners.push(fn); },
        },
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
  await page.addStyleTag({ path: path.join(ROOT, 'content/content.css') });
  await page.addStyleTag({ path: path.join(ROOT, 'content/content-region.css') });
  await page.waitForSelector('#taskplugin-float-btn', { state: 'attached', timeout: 15000 });
}

test.describe('Alt+Shift+E region pick not blocked by float', () => {
  test('opens float then region select: panel closes, hint under body', async ({ page }) => {
    await loadPluginIntoPage(page);

    await page.click('#taskplugin-float-btn');
    await page.waitForFunction(
      () => document.getElementById('taskplugin-float-panel')?.classList.contains('taskplugin-open'),
      null,
      { timeout: 8000 },
    );

    const started = await page.evaluate(() => {
      if (typeof startPageAdvisorRegionSelect !== 'function') {
        return { ok: false, error: 'startPageAdvisorRegionSelect missing' };
      }
      return startPageAdvisorRegionSelect();
    });
    expect(started.ok !== false).toBeTruthy();
    expect(started.active).toBe(true);

    const state = await page.evaluate(() => {
      const panel = document.getElementById('taskplugin-float-panel');
      const hint = document.getElementById('taskplugin-region-select-hint');
      const floatRoot = document.getElementById('taskplugin-float-root');
      return {
        panelOpen: panel ? panel.classList.contains('taskplugin-open') : false,
        hintParentIsBody: !!(hint && hint.parentElement === document.body),
        hintInsideFloatRoot: !!(hint && floatRoot && floatRoot.contains(hint)),
        selecting: document.documentElement.classList.contains('taskplugin-region-selecting'),
      };
    });
    expect(state.panelOpen).toBe(false);
    expect(state.hintParentIsBody).toBe(true);
    expect(state.hintInsideFloatRoot).toBe(false);
    expect(state.selecting).toBe(true);

    await page.click('#host-para');
    await page.waitForFunction(
      () => Array.isArray(window.__sentMessages)
        && window.__sentMessages.some((m) => m && m.action === 'pageOptimizationSuggest'),
      null,
      { timeout: 8000 },
    );

    const pendingOk = await page.evaluate(() => {
      const els = typeof getPendingPageAdvisorElements === 'function'
        ? getPendingPageAdvisorElements()
        : null;
      if (!els || !els.length) return { ok: false, reason: 'no pending elements' };
      const text = els.map((el) => (el.innerText || el.textContent || '')).join(' ');
      return {
        ok: text.includes('HOST_PAGE_TEXT_UNIQUE') && !text.includes('快速创建任务'),
        text,
      };
    });
    expect(pendingOk.ok).toBe(true);
  });
});
