/**
 * 浮窗 × 仅收起面板 E2E（Playwright）
 *
 * 背景：OPT-20260822-031。content.js 的 #taskplugin-float-close 点击只应调用
 * hideFloatPanel()（收起面板），不得写 storage.floatBallEnabled、不得隐藏悬浮球。
 * 此前仅以源码契约单测覆盖（content 是 IIFE，无法在真实页面点击 × 后断言面板
 * 状态与悬浮球可见性）。
 *
 * 验证（加载真实 lib 链 + content.js）：
 * 1. 点悬浮球打开面板 → #taskplugin-float-panel 带 taskplugin-open
 * 2. 点 ×（#taskplugin-float-close）→ 面板移除 taskplugin-open
 * 3. 悬浮球 #taskplugin-float-btn 仍可见（未 display:none）
 * 4. storage.floatBallEnabled 未被动过（仍为 true）
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

/** 与 manifest.json content_scripts 相同的加载顺序 */
const LIB_FILES = [
  'lib/storage.js',
  'lib/dom-trace.js',
  'lib/create-task-git-identity.js',
  'lib/create-task-payload.js',
  'lib/element-picker.js',
  'lib/user-guide.js',
  'lib/float-workspace-select.js',
  'lib/float-panel-after-create.js',
  'lib/aidev-meta.js',
  'lib/page-bridge.js',
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
          if (msg && msg.action === 'getAuthStatus') {
            data = { ...data, loggedIn: false, token: '' };
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
          _store: { floatBallEnabled: true, trackingEnabled: false },
          async get(keys) {
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const k of list) out[k] = this._store[k];
            return out;
          },
          // set 触发 storage.onChanged（OPT-20260806-015）：模拟真实 chrome.storage 语义
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
  // 本环境 Playwright 的 addInitScript 在 setContent 文档上不生效，
  // 需先 goto 空白页（init script 会在该文档运行），再注入页面内容与脚本
  await page.addInitScript(installChromeStubs());
  await page.goto('about:blank');
  await page.evaluate(
    `document.body.innerHTML = '<h1>Float Close Test</h1><p>content</p>';`,
  );
  for (const rel of LIB_FILES) {
    await page.addScriptTag({ path: path.join(ROOT, rel) });
  }
  await page.waitForSelector('#taskplugin-float-btn', { state: 'attached', timeout: 10000 });
}

/** 读取面板/悬浮球/存储三态 */
async function panelState(page) {
  return page.evaluate(() => {
    const panel = document.getElementById('taskplugin-float-panel');
    const btn = document.getElementById('taskplugin-float-btn');
    const btnVisible = btn
      ? (btn.offsetWidth > 0 || btn.offsetHeight > 0) && getComputedStyle(btn).display !== 'none'
      : false;
    return {
      open: panel ? panel.classList.contains('taskplugin-open') : false,
      btnAttached: !!btn,
      btnVisible,
      floatBallEnabled: window.chrome.storage.local._store.floatBallEnabled,
    };
  });
}

test.describe('浮窗 × 仅收起面板', () => {
  test('点悬浮球打开面板后点 × 只收起面板，悬浮球可见且 floatBallEnabled 不变', async ({ page }) => {
    await loadPluginIntoPage(page);

    // 初始：面板收起、悬浮球可见、floatBallEnabled=true
    expect(await panelState(page)).toEqual({
      open: false,
      btnAttached: true,
      btnVisible: true,
      floatBallEnabled: true,
    });

    // 点悬浮球 → 面板打开
    await page.click('#taskplugin-float-btn');
    await page.waitForFunction(
      () => document.getElementById('taskplugin-float-panel')?.classList.contains('taskplugin-open'),
      null,
      { timeout: 5000 },
    );
    expect((await panelState(page)).open).toBe(true);

    // 点 ×（#taskplugin-float-close）→ 面板收起
    await page.click('#taskplugin-float-close');
    await page.waitForFunction(
      () => !document.getElementById('taskplugin-float-panel')?.classList.contains('taskplugin-open'),
      null,
      { timeout: 5000 },
    );

    // 收起后：面板无 open、悬浮球仍可见、floatBallEnabled 未被写 false
    const after = await panelState(page);
    expect(after.open).toBe(false);
    expect(after.btnAttached).toBe(true);
    expect(after.btnVisible).toBe(true);
    expect(after.floatBallEnabled).toBe(true);

    // 再次点悬浮球仍可重新打开（关闭动作不破坏后续交互）
    await page.click('#taskplugin-float-btn');
    await page.waitForFunction(
      () => document.getElementById('taskplugin-float-panel')?.classList.contains('taskplugin-open'),
      null,
      { timeout: 5000 },
    );
    expect((await panelState(page)).open).toBe(true);
  });
});
