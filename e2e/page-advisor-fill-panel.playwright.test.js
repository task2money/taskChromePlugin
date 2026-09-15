/**
 * 建议展示期间「快速创建任务」面板保持关闭，填入后才打开（OPT-20260915-026）
 *
 * 单测（test/float-page-advisor-fill-panel.test.js）用 vm 桩覆盖了源码契约；
 * 本用例在真实浏览器里核对 `#taskplugin-float-panel` 的 `taskplugin-open` 状态、
 * 真实 DOM 布局与描述框内容：
 * 1. 打开面板 → 建议返回（showPageAdvisorSuggestions）后面板收起
 * 2. 点击「全部填入任务描述」→ 面板重新打开，`#taskplugin-desc` 含建议文案
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

const SUGGESTIONS = [
  {
    id: 's1',
    title: '优化价格区层级',
    summary: '摘要一',
    detail: '把价格数字提到 CTA 上方',
    target_nid: 'host-para',
  },
  {
    id: 's2',
    title: '补充信任背书',
    summary: '摘要二',
    detail: '增加客户 Logo 与合规标识',
    target_nid: 'host-side',
  },
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
      <h1 id="host-title" data-taskplugin-nid="host-title">Host Page Title</h1>
      <p id="host-para" data-taskplugin-nid="host-para">HOST_PAGE_TEXT_UNIQUE</p>
      <div id="host-side" data-taskplugin-nid="host-side">HOST_SIDE_UNIQUE</div>
    `;
  });
  for (const rel of LIB_FILES) {
    await page.addScriptTag({ path: path.join(ROOT, rel) });
  }
  // 与 manifest content_scripts[0].css 对齐 —— 缺样式时面板/建议卡尺寸为 0，
  // 点击与可见性断言都会失真。
  for (const rel of [
    'content/content.css',
    'content/content-form.css',
    'content/page-advisor.css',
    'content/content-region.css',
    'content/content-guide.css',
  ]) {
    await page.addStyleTag({ path: path.join(ROOT, rel) });
  }
  await page.waitForSelector('#taskplugin-float-btn', { state: 'attached', timeout: 15000 });
}

function readPanel(page) {
  return page.evaluate(() => {
    const panel = document.getElementById('taskplugin-float-panel');
    const layer = document.getElementById('taskplugin-page-advisor-layer');
    const allBtn = document.getElementById('taskplugin-page-advisor-fill-all');
    const desc = document.getElementById('taskplugin-desc');
    return {
      panelOpen: !!(panel && panel.classList.contains('taskplugin-open')),
      layerVisible: !!(layer && !layer.hidden),
      fillAllVisible: !!(allBtn && allBtn.offsetParent !== null),
      fillAllDisabled: !!(allBtn && allBtn.disabled),
      desc: desc ? String(desc.value || '') : null,
      cardCount: document.querySelectorAll('.taskplugin-page-advisor-float-card').length,
    };
  });
}

test.describe('建议展示期间面板保持关闭，填入后打开', () => {
  test('show suggestions keeps panel closed; fill-all opens panel and appends text', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err && err.message)));

    await loadPluginIntoPage(page);

    // 打开「快速创建任务」面板（真实用户入口）
    await page.click('#taskplugin-float-btn');
    await page.waitForFunction(
      () => !!document
        .getElementById('taskplugin-float-panel')
        ?.classList.contains('taskplugin-open'),
      null,
      { timeout: 8000 },
    );
    expect((await readPanel(page)).panelOpen).toBe(true);

    // 建议返回：面板应保持关闭，建议层可见
    await page.evaluate((suggestions) => {
      showPageAdvisorSuggestions({
        suggestions,
        pageUrl: 'https://example.test/page',
        jobId: 'job-1',
      });
    }, SUGGESTIONS);
    await page.waitForSelector('.taskplugin-page-advisor-float-card', { timeout: 8000 });

    const during = await readPanel(page);
    expect(during.cardCount).toBe(SUGGESTIONS.length);
    expect(during.panelOpen).toBe(false);
    expect(during.layerVisible).toBe(true);
    expect(during.fillAllVisible).toBe(true);
    expect(during.fillAllDisabled).toBe(false);
    expect(during.desc).not.toContain('页面优化建议');

    // 点击「全部填入任务描述」→ 面板打开且描述含建议文案
    await page.click('#taskplugin-page-advisor-fill-all');
    await page.waitForFunction(
      () => !!document
        .getElementById('taskplugin-float-panel')
        ?.classList.contains('taskplugin-open'),
      null,
      { timeout: 8000 },
    );

    const after = await readPanel(page);
    expect(after.panelOpen).toBe(true);
    expect(after.desc).toContain('## 页面优化建议（Alt+Z）');
    for (const s of SUGGESTIONS) {
      expect(after.desc).toContain(`[${s.title}]`);
      expect(after.desc).toContain(s.detail);
    }
    expect(after.desc).toContain('来源页: https://example.test/page');

    expect(pageErrors).toEqual([]);
  });
});
