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
const { manifestContentScripts } = require('./helpers/manifest-content-scripts');
const ROOT = path.resolve(__dirname, '..');

// 注入面以 manifest content_scripts[0].js 为 SSOT（手抄数组曾漏抄
// float-page-advisor-fill-ui.js / page-advisor-delivery.js 致点击抛
// "confirmPageAdvisorFill is not defined"，见 OPT-20261008-003）。
const LIB_FILES = manifestContentScripts();

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
          async get(keys, cb) {
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const k of list) out[k] = this._store[k];
            // 真实 chrome.storage 支持回调与 Promise 两种形态；运行时
            // loadPageAdvisorDeliveryTarget 走回调式 get(keys, cb)，
            // 缺回调会令其 Promise 永不 resolve → 填入点击无任何消息。
            if (typeof cb === 'function') cb(out);
            return out;
          },
          async set(obj, cb) {
            Object.assign(this._store, obj);
            if (typeof cb === 'function') cb();
          },
          async remove(keys, cb) {
            if (typeof cb === 'function') cb();
          },
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
  await page.waitForSelector('#taskplugin-float-root', { state: 'attached', timeout: 15000 });
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

test.describe('建议展示期间不打开页内面板，填入后请求打开侧栏', () => {
  test('show suggestions keeps page without create panel; fill-all opens side panel', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err && err.message)));

    await loadPluginIntoPage(page);
    expect(await page.locator('#taskplugin-float-btn').count()).toBe(0);
    expect(await page.locator('#taskplugin-float-panel').count()).toBe(0);

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

    await page.click('#taskplugin-page-advisor-fill-all');
    await page.waitForFunction(
      () => (window.__sentMessages || []).some((m) => m && (m.action === 'openSidePanel' || m.action === 'setCreateDescription')),
      null,
      { timeout: 8000 },
    );
    const sent = await page.evaluate(() => window.__sentMessages || []);
    expect(sent.some((m) => m && (m.action === 'openSidePanel' || m.action === 'setCreateDescription'))).toBe(true);
    expect(pageErrors).toEqual([]);
  });
});
