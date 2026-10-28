/**
 * Popup 面板布局 E2E（Playwright）
 *
 * 加载真实 popup.html + popup.js，注入最小 chrome.* stub（未登录态）：
 * - 断言面板宽度收窄（body ≤ 300px，快捷键说明区不需要那么宽）
 * - 断言快捷键说明默认收起（#shortcutsBody 不可见）
 * - 点击「展开」→ 显示快捷键列表；再点「收起」→ 隐藏（点击后再展开）
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

const POPUP_HTML = path.join(__dirname, '..', 'popup', 'popup.html');
const POPUP_URL = pathToFileURL(POPUP_HTML).href;

/** 顶栏 Beta 下载链接夹具：tag 比 stub 的 1.8.54 新，asset 名与打包脚本一致。 */
const LATEST_RELEASE_FIXTURE = {
  tag_name: 'v1.8.93',
  assets: [
    {
      name: 'task-chrome-plugin-v1.8.93.zip',
      browser_download_url: 'https://github.com/task2money/taskChromePlugin/releases/download/v1.8.93/task-chrome-plugin-v1.8.93.zip',
    },
  ],
};

/**
 * 最小 stub：未登录态（getAuthStatus 无 token → showLoginUI → 快捷键区可见但折叠）。
 *
 * options.installType 提供时补 chrome.management.getSelf（Beta 判定），
 * options.release 提供时把 GitHub latest release 接口换成夹具，避免真网络。
 * options.languageModel 为真时注入 LanguageModel stub，用于断言旧「内置模型」控件已删除。
 */
async function installChromeStub(page, options = {}) {
  await page.addInitScript(({ installType, release, token, username, languageModel, workspaces }) => {
    try { localStorage.setItem('aidevpush.locale', 'zh-CN'); } catch (_) { /* ignore */ }
    // 发布包形态：域名由打包期注入；源码树的 values 文件为空。
    globalThis.__TASKPLUGIN_RUNTIME_CONFIG__ = {
      gatewayBaseUrl: 'https://aidevpush.com',
      siteBaseUrl: 'https://www.aidevpush.com',
      legacyHosts: [],
    };
    const store = {
      baseUrl: 'https://aidevpush.com',
      token: token || '',
      tokenExpiresAt: 0,
      tokenIssuedAt: 0,
      username: username || '',
      userId: '',
      memberId: '',
      'aidevpush.locale': 'zh-CN',
    };
    const area = {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) out[k] = store[k];
        return out;
      },
      async set(obj) { Object.assign(store, obj); },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) delete store[k];
      },
    };
    const chromeApi = {
      runtime: {
        getManifest: () => ({ version: '1.8.54' }),
        sendMessage: async (msg) => {
          if (msg?.action === 'getAuthStatus') {
            return {
              success: true,
              data: {
                baseUrl: store.baseUrl, token: store.token,
                tokenExpiresAt: store.tokenExpiresAt, tokenIssuedAt: store.tokenIssuedAt,
                username: store.username, userId: store.userId, memberId: store.memberId,
                expired: false, loggedIn: !!store.token,
                remainingSeconds: store.token ? Infinity : -1, expiryHint: null,
              },
            };
          }
          if (msg?.action === 'getWorkspaces') {
            return {
              success: true,
              data: workspaces || [
                { id: 'ws-a', name: '空间A', company_id: 'co1' },
                { id: 'ws-b', name: '空间B', company_id: 'co1' },
              ],
            };
          }
          if (msg?.action === 'getOwnAgents') {
            return {
              success: true,
              data: {
                providers: [
                  { provider: 'deepseek', remark: '公司主账号', supported_models: ['deepseek-chat'] },
                ],
              },
            };
          }
          if (msg?.action === 'getSystemAgents') {
            return {
              success: true,
              data: { items: [{ id: 'sku-a', name: '系统甲' }, { id: 'sku-b', name: '系统乙' }] },
            };
          }
          return { success: true };
        },
        lastError: null,
      },
      storage: { local: area, session: { async get() { return {}; }, async set() {} } },
      tabs: { async query() { return []; }, sendMessage: async () => {} },
    };
    // 只有显式给 installType 时才挂 management：默认用例保持「非 Beta」不变。
    if (installType) chromeApi.management = { getSelf: async () => ({ installType }) };
    if (release) {
      const realFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
      window.fetch = async (url, init) => {
        if (String(url).includes('api.github.com/repos/task2money/taskChromePlugin/releases/latest')) {
          return { ok: true, status: 200, json: async () => release };
        }
        if (realFetch) return realFetch(url, init);
        throw new Error('e2e stub: no network');
      };
    }
    if (languageModel) {
      // 仅让 popup-builtin-mgmt 露出内置单选；不模拟真实 on-device 推理。
      window.LanguageModel = { availability: async () => 'available' };
    }
    window.chrome = chromeApi;
  }, {
    installType: options.installType || '',
    release: options.release || null,
    token: options.token || '',
    username: options.username || '',
    languageModel: !!options.languageModel,
    workspaces: options.workspaces || null,
  });
}

test.describe('Popup 面板布局', () => {
  test('面板宽度收窄至 300px 内（快捷键说明区不需要那么宽）', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);
    await expect(page.locator('#shortcutsSection')).toBeVisible({ timeout: 10000 });
    const width = await page.evaluate(() => document.body.getBoundingClientRect().width);
    expect(width).toBeLessThanOrEqual(300);
  });

  test('快捷键说明默认收起，点击「展开」后显示，再点「收起」恢复隐藏', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);

    const toggle = page.locator('#btnToggleShortcuts');
    const body = page.locator('#shortcutsBody');
    await expect(toggle).toBeVisible({ timeout: 10000 });
    await expect(toggle).toHaveText('展开');
    // 初始折叠：快捷键内容不可见
    await expect(body).toBeHidden();
    await expect(page.locator('#btnPickShortcutEdit')).toBeHidden();

    // 点击展开 → 内容可见，按钮变「收起」
    await toggle.click();
    await expect(body).toBeVisible();
    await expect(page.locator('#btnPickShortcutEdit')).toBeVisible();
    await expect(toggle).toHaveText('收起');

    // 再点收起 → 恢复隐藏
    await toggle.click();
    await expect(body).toBeHidden();
    await expect(toggle).toHaveText('展开');
  });

  test('顶栏可见插件版本（来自 getManifest）', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);
    const ver = page.locator('#popupVersion');
    await expect(ver).toBeVisible({ timeout: 10000 });
    await expect(ver).toHaveText('v1.8.54');
  });

  test('开发者模式顶栏标 Beta，并链到最新 Release 的 zip', async ({ page }) => {
    await installChromeStub(page, { installType: 'development', release: LATEST_RELEASE_FIXTURE });
    await page.goto(POPUP_URL);
    const ver = page.locator('#popupVersion');
    await expect(ver).toBeHidden({ timeout: 10000 });

    const link = page.locator('[data-plugin-version-update]');
    await expect(link).toBeVisible({ timeout: 10000 });
    await expect(link).toHaveText('有新版本 v1.8.93 可下载');
    await expect(link).toHaveAttribute('href', LATEST_RELEASE_FIXTURE.assets[0].browser_download_url);
    await expect(link).toHaveAttribute('target', '_blank');
    expect(await link.getAttribute('href')).toContain('/task2money/taskChromePlugin/releases/download/');
    expect(await link.getAttribute('href')).toMatch(/\.zip$/);
  });

  test('普通安装不标 Beta，也不出现 Release 下载链接', async ({ page }) => {
    await installChromeStub(page, { installType: 'normal', release: LATEST_RELEASE_FIXTURE });
    await page.goto(POPUP_URL);
    const ver = page.locator('#popupVersion');
    await expect(ver).toBeVisible({ timeout: 10000 });
    await expect(ver).toHaveText('v1.8.54');
    await expect(page.locator('[data-plugin-version-update]')).toHaveCount(0);
  });

  test('未登录时登录表单默认收起，点「登录」才展开', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);
    const toggle = page.locator('#btnToggleLogin');
    await expect(toggle).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#loginSection')).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText('登录');
    await toggle.click();
    await expect(page.locator('#loginSection')).toBeVisible();
    await expect(page.locator('#btnLogin')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('未登录态不展示「固定到工具栏」，且无悬浮球开关', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);
    await expect(page.locator('#shortcutsSection')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#toolbarPinSection')).toHaveCount(0);
    await expect(page.locator('#toolbarPinStatus')).toHaveCount(0);
    await expect(page.locator('#floatBallToggle')).toHaveCount(0);
    await expect(page.locator('#requestsSection')).toBeHidden();
  });

  test('未登录无网页优化设置：工作空间区隐藏，旧调用方式/Skill 区已删除', async ({ page }) => {
    await installChromeStub(page, { languageModel: true });
    await page.goto(POPUP_URL);
    const section = page.locator('#pageAdvisorWorkspaceSection');
    await expect(section).toHaveCount(1, { timeout: 10000 });
    await expect(section).toBeHidden();
    await expect(page.locator('#popupPageAdvisorWorkspace')).toBeHidden();
    await expect(page.locator('#popupLlmRouteSaas')).toHaveCount(0);
    await expect(page.locator('#popupLlmRouteDirect')).toHaveCount(0);
    await expect(page.locator('#pageAdvisorLlmSection')).toHaveCount(0);
    await expect(page.locator('#pageAdvisorSkillSection')).toHaveCount(0);
    await expect(page.locator('#pageAdvisorDefaultsSection')).toHaveCount(0);
  });

  // 登录后设置区只有工作空间下拉：选择即生效并落盘。
  test('登录后出现工作空间下拉，选择后落盘', async ({ page }) => {
    await installChromeStub(page, { token: 'at_e2e_workspace', username: 'ada' });
    await page.goto(POPUP_URL);
    await expect(page.locator('#pageAdvisorWorkspaceSection')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#pageAdvisorWorkspaceSection')).toContainText('工作空间');
    const select = page.locator('#popupPageAdvisorWorkspace');
    await expect(select).toBeEnabled();
    // 无平台默认、未手选过 → 占位 + 两个工作空间
    await expect(select.locator('option')).toHaveCount(3, { timeout: 10000 });
    await expect(select).toContainText('空间A');
    await expect(select).toContainText('空间B');
    await select.selectOption('ws-a');
    await expect(select).toHaveValue('ws-a');
    const saved = await page.evaluate(async () => {
      const raw = await chrome.storage.local.get(['lastWorkspaceId', 'lastWorkspaceManual']);
      return `${raw.lastWorkspaceId}|${raw.lastWorkspaceManual}`;
    });
    expect(saved).toBe('ws-a|true');

    // 侧栏宽度下工作空间区仍可见、下拉有几何框。
    await page.setViewportSize({ width: 720, height: 900 });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-taskplugin-host', 'sidepanel');
    });
    await expect(select).toBeVisible();
    const wsBox = await select.boundingBox();
    expect(wsBox, '工作空间下拉应有几何框').toBeTruthy();
  });

  // 1.8.267：登录后自动选中平台默认工作空间（is_default）；
  // 手动切换后记手选、之后不再被默认覆盖。
  test('登录后自动选中平台默认工作空间，手动切换后记手选', async ({ page }) => {
    await installChromeStub(page, {
      token: 'at_e2e_ws_default',
      username: 'ada',
      workspaces: [
        { id: 'ws-a', name: '空间A', company_id: 'co1' },
        { id: 'ws-b', name: '空间B', company_id: 'co1', is_default: true },
      ],
    });
    await page.goto(POPUP_URL);
    await expect(page.locator('#pageAdvisorWorkspaceSection')).toBeVisible({ timeout: 10000 });
    const select = page.locator('#popupPageAdvisorWorkspace');
    // 自动选中后不再渲染「请选择工作空间」占位 → 只有两个工作空间选项。
    await expect(select.locator('option')).toHaveCount(2, { timeout: 10000 });
    await expect(select).toHaveValue('ws-b');
    await expect.poll(async () => page.evaluate(async () => {
      const raw = await chrome.storage.local.get(['lastWorkspaceId', 'lastWorkspaceManual']);
      return `${raw.lastWorkspaceId}|${raw.lastWorkspaceManual}`;
    })).toBe('ws-b|false');

    // 手动切换 → 记手选（跨次打开的「不再被默认覆盖」由 test/popup-saas-workspace-default.test.js 覆盖）。
    await select.selectOption('ws-a');
    await expect(select).toHaveValue('ws-a');
    await expect.poll(async () => page.evaluate(async () => {
      const raw = await chrome.storage.local.get(['lastWorkspaceId', 'lastWorkspaceManual']);
      return `${raw.lastWorkspaceId}|${raw.lastWorkspaceManual}`;
    })).toBe('ws-a|true');
  });

  test('区域说明默认收在 ! 内，点击后再展开', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);
    const field = page.locator('#popupDeliveryTargetField');
    await expect(field).toBeVisible({ timeout: 10000 });
    const hint = field.locator('[data-region-help]');
    await expect(hint).toBeHidden();
    await field.locator('summary.region-help-mark').click();
    await expect(hint).toBeVisible();
  });

  // OPT-20261007-005：转发目标增至 6+ 个时的换行与 radio 对齐，改为几何断言
  // （原「目视核对」不可机器复现，被 OPTIMIZATION_TODOS.ai.md「禁止人工验收」否决）。
  // 用合成目标补齐到 7 个（>6），使断言与生产实际目标数解耦——每新增一个 IDE 目标都受此护栏。
  test('转发目标增至 6+ 时换行、同行 radio 对齐且不溢出字段宽度', async ({ page }) => {
    await installChromeStub(page, { token: 'at_e2e_ws', username: 'ada' });
    await page.goto(POPUP_URL);
    const field = page.locator('#popupDeliveryTargetField');
    await expect(field).toBeVisible({ timeout: 10000 });

    const geo = await field.evaluate((el) => {
      // 合成 3 个后续 IDE 目标（value/文案仅用于几何验证，不写存储）
      for (const v of ['windsurf', 'trae', 'vscode']) {
        const label = document.createElement('label');
        label.className = 'llm-route-option';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'pageAdvisorDeliveryTarget';
        input.value = v;
        const span = document.createElement('span');
        span.textContent = v.charAt(0).toUpperCase() + v.slice(1);
        label.append(input, span);
        el.append(label);
      }
      const fieldRect = el.getBoundingClientRect();
      const items = [...el.querySelectorAll('.llm-route-option')].map((o) => {
        const r = o.getBoundingClientRect();
        const i = o.querySelector('input').getBoundingClientRect();
        return {
          text: o.textContent.trim(),
          top: Math.round(r.top),
          right: Math.round(r.right),
          width: Math.round(r.width),
          midY: Math.round(i.top + i.height / 2),
        };
      });
      return { fieldRight: Math.round(fieldRect.right), count: items.length, items };
    });

    // 至少 6 个目标参与几何校验
    expect(geo.count).toBeGreaterThanOrEqual(6);

    // 已换行：≥2 个不同的行 top（7 个真实文案在 300px 下无法单行容纳）
    const rowTops = [...new Set(geo.items.map((it) => it.top))];
    expect(rowTops.length).toBeGreaterThanOrEqual(2);

    // 无横向溢出：每个选项右缘都在字段右边界内（flex-wrap 生效；nowrap 时必然失败）
    for (const it of geo.items) {
      expect(it.width).toBeGreaterThan(0);
      expect(
        it.right,
        `「${it.text}」右缘 ${it.right} 越过字段右界 ${geo.fieldRight}`,
      ).toBeLessThanOrEqual(geo.fieldRight + 1);
    }

    // 同行 radio 垂直中点一致（align-items 未被破坏）
    for (const top of rowTops) {
      const mids = geo.items.filter((it) => it.top === top).map((it) => it.midY);
      expect(Math.max(...mids) - Math.min(...mids)).toBeLessThanOrEqual(1);
    }
  });
});
