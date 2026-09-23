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
 */
async function installChromeStub(page, options = {}) {
  await page.addInitScript(({ installType, release }) => {
    try { localStorage.setItem('aidevpush.locale', 'zh-CN'); } catch (_) { /* ignore */ }
    const store = {
      baseUrl: 'https://aidevpush.com',
      token: '',
      tokenExpiresAt: 0,
      tokenIssuedAt: 0,
      username: '',
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
              data: [
                { id: 'ws-a', name: '空间A', company_id: 'co1' },
                { id: 'ws-b', name: '空间B', company_id: 'co1' },
              ],
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
    window.chrome = chromeApi;
  }, { installType: options.installType || '', release: options.release || null });
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
    await expect(ver).toBeVisible({ timeout: 10000 });
    await expect(ver).toHaveText('v1.8.54 Beta');

    const link = page.locator('[data-plugin-version-update]');
    await expect(link).toBeVisible({ timeout: 10000 });
    await expect(link).toHaveAttribute('href', LATEST_RELEASE_FIXTURE.assets[0].browser_download_url);
    await expect(link).toHaveAttribute('target', '_blank');
    expect(await link.getAttribute('href')).toContain('/task2money/taskChromePlugin/releases/download/');
    expect(await link.getAttribute('href')).toMatch(/\.zip$/);
    // 下载链接排在版本号之后，顶栏里不会被别的元素挤掉。
    const verBox = await ver.boundingBox();
    const linkBox = await link.boundingBox();
    expect(verBox && linkBox).toBeTruthy();
    expect(linkBox.y).toBeLessThan(verBox.y + verBox.height);
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
    await expect(page.locator('#popupSkillStatus')).toContainText('仅保存在本机');
    await expect(page.locator('#loginSection')).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText('登录');
    await toggle.click();
    await expect(page.locator('#loginSection')).toBeVisible();
    await expect(page.locator('#btnLogin')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('未登录态可见「显示悬浮球」开关，且不在请求预览区内', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);
    await expect(page.locator('#floatBallSection')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#floatBallToggle')).toBeAttached();
    await expect(page.locator('#floatBallSection .toggle-slider')).toBeVisible();
    await expect(page.locator('#floatBallSection')).toContainText('显示悬浮球');
    await expect(page.locator('#requestsSection')).toBeHidden();
  });

  test('Auto-innovate 设置按钮展开 API Key 区，再点收起', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);
    await expect(page.locator('#pageAdvisorLlmSection')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#pageAdvisorDefaultsSection')).toHaveCount(0);
    await expect(page.locator('#pageAdvisorLlmSection kbd.llm-shortcut')).toHaveText('Alt+Shift+Z');
    const toggle = page.locator('#btnToggleLlmSettings');
    const fields = page.locator('#pageAdvisorLlmFields');
    await expect(toggle).toBeVisible();
    await expect(fields).toBeHidden();
    await toggle.click();
    await expect(fields).toBeVisible();
    await expect(page.locator('#popupLlmApiKey')).toBeVisible();
    await toggle.click();
    await expect(fields).toBeHidden();
  });

  test('提示词 Skill 设置按钮展开管理区，再点收起', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);
    await expect(page.locator('#pageAdvisorSkillSection')).toBeVisible({ timeout: 10000 });
    const toggle = page.locator('#btnToggleSkillSettings');
    const fields = page.locator('#pageAdvisorSkillFields');
    await expect(toggle).toBeVisible();
    await expect(fields).toBeHidden();
    await toggle.click();
    await expect(fields).toBeVisible();
    await expect(page.locator('#popupSkillEditor')).toBeHidden();
    await expect(page.locator('#btnSkillHistoryLoad')).toHaveCount(0);
    await expect(page.locator('#pageAdvisorSkillFields legend.popup-skill-saved-legend #btnSkillNew')).toBeVisible();
    await expect(page.locator('#popupSkillList .popup-skill-category-pick')).toHaveCount(5);
    await expect(page.locator('#popupSkillList .popup-skill-row:not(.popup-skill-row-none)')).toHaveCount(0);
    await expect(page.locator('label[for="popupSkillTendency"]')).toHaveText(/类别|Category/);
    await page.locator('#btnSkillNew').click();
    await expect(page.locator('#popupSkillEditor')).toBeVisible();
    await expect(page.locator('#popupSkillSyncTarget')).toBeVisible();
    await expect(page.locator('#popupSkillSyncTarget option[value="local"]')).toHaveCount(1);
    await expect(page.locator('#popupSkillSyncTarget option[value="ws-a"]')).toHaveCount(1);
    await expect(page.locator('#popupSkillSyncTarget option[value="ws-b"]')).toHaveCount(1);
    await page.locator('#popupSkillTitle').fill('e2e-skill');
    await page.locator('#popupSkillBody').fill('body');
    await page.locator('#popupSkillSyncTarget').selectOption('local');
    await page.locator('#btnSkillSave').click();
    await expect(fields).toBeHidden();
    await toggle.click();
    await expect(fields).toBeVisible();
    await expect(page.locator('#popupSkillEditor')).toBeHidden();
    await expect(page.locator('#popupSkillList .popup-skill-category-pick')).toHaveCount(5);
    await expect(page.locator('#popupSkillList .popup-skill-row:not(.popup-skill-row-none)')).toHaveCount(0);
    await page.locator('#popupSkillList [data-tendency="custom"]').click();
    await expect(page.locator('#popupSkillList .popup-skill-category-source')).toHaveCount(0);
    const row = page.locator('#popupSkillList .popup-skill-row').filter({ hasText: 'e2e-skill' });
    await expect(row.locator('select.popup-skill-sync')).toHaveCount(1);
    await expect(row.locator('select.popup-skill-sync')).toHaveValue('local');
    await expect(row.locator('.popup-skill-row-title')).toBeVisible();
    await expect(row.locator('.popup-skill-row-actions')).toBeVisible();
    const titleBox = await row.locator('.popup-skill-row-title').boundingBox();
    const actionsBox = await row.locator('.popup-skill-row-actions').boundingBox();
    expect(titleBox && actionsBox && actionsBox.y).toBeGreaterThan(titleBox.y);
    await expect(page.locator('#popupSkillRadio_none')).toBeVisible();
    await expect(page.locator('#popupSkillRadio_none')).not.toBeChecked();
    await expect(row.getByRole('button', { name: /编辑|Edit/ })).toBeVisible();
    await expect(row.getByRole('button', { name: /删除|Delete/ })).toBeVisible();
    await row.getByRole('button', { name: /删除|Delete/ }).click();
    await expect(page.locator('#popupSkillDeleteConfirm')).toBeVisible();
    await page.locator('#btnSkillDeleteCancel').click();
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: /编辑|Edit/ }).click();
    await expect(page.locator('#popupSkillEditor')).toBeVisible();
    await expect(page.locator('#popupSkillTitle')).toHaveValue('e2e-skill');
    await row.locator('select.popup-skill-sync').selectOption('ws-b');
    await expect(row.locator('select.popup-skill-sync')).toHaveValue('ws-b');
    await expect(row.locator('.popup-skill-saas-link')).toHaveAttribute(
      'href',
      'https://aidevpush.com/tenant/co1/settings/workspace/ws-b/prompt-skills/',
    );
    await toggle.click();
    await expect(fields).toBeHidden();
  });

  test('保存智能体配置后收起 API Key 区', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);
    await expect(page.locator('#pageAdvisorLlmSection')).toBeVisible({ timeout: 10000 });
    await page.locator('#btnToggleLlmSettings').click();
    await expect(page.locator('#pageAdvisorLlmFields')).toBeVisible();
    await page.locator('#popupLlmBaseUrl').fill('https://api.deepseek.com/v1');
    await page.locator('#popupLlmModel').fill('deepseek-chat');
    await page.locator('#popupLlmApiKey').fill('test-api-key-local');
    await page.locator('#btnSaveLlmConfig').click();
    await expect(page.locator('#pageAdvisorLlmFields')).toBeHidden();
    await expect(page.locator('#popupLlmStatus')).toContainText(/已保存|saved/i);
  });

  test('区域说明默认收在 ! 内，点击后再展开', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);
    await expect(page.locator('#pageAdvisorLlmSection')).toBeVisible({ timeout: 10000 });
    const hint = page.locator('#pageAdvisorLlmSection [data-i18n="paLlmSectionHint"]');
    await expect(hint).toBeHidden();
    await page.locator('#pageAdvisorLlmSection summary.region-help-mark').click();
    await expect(hint).toBeVisible();
  });
});
