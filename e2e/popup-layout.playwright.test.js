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
 * options.languageModel 为真时注入 LanguageModel stub，使「内置模型」单选可见。
 */
async function installChromeStub(page, options = {}) {
  await page.addInitScript(({ installType, release, token, username, languageModel }) => {
    try { localStorage.setItem('aidevpush.locale', 'zh-CN'); } catch (_) { /* ignore */ }
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
              data: [
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
  });
}

/** 读取 stub 存储里当前生效的 API Key（只回值，不打印）。 */
async function currentStoredApiKey(page) {
  return page.evaluate(async () => {
    const raw = await chrome.storage.local.get(['pageAdvisorLlmApiKey']);
    return String(raw?.pageAdvisorLlmApiKey || '');
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
    const market = page.locator('#lnkPromptMarket');
    await expect(market).toBeVisible({ timeout: 10000 });
    await expect(market).toHaveText('提示词集市');
    await expect(market).toHaveAttribute('href', 'https://aidevpush.com/prompt-shares/');
    await expect(market).toHaveAttribute('target', '_blank');
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
    await expect(page.locator('#pageAdvisorLlmSection')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#toolbarPinSection')).toHaveCount(0);
    await expect(page.locator('#toolbarPinStatus')).toHaveCount(0);
    await expect(page.locator('#floatBallToggle')).toHaveCount(0);
    await expect(page.locator('#requestsSection')).toBeHidden();
  });

  test('Auto-innovate 设置按钮展开 API Key 区，再点收起', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);
    await expect(page.locator('#pageAdvisorLlmSection')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#pageAdvisorDefaultsSection')).toHaveCount(0);
    await expect(page.locator('#popupLlmRouteSaas')).toBeChecked();
    await page.locator('#popupLlmRouteDirect').check();
    await expect(page.locator('#popupSaasWorkspaceRow')).toBeHidden();
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

  // OPT-20261002-021：几何回归——设置须在「已保存的 Key」下拉右侧、同属 profile 行。
  test('LLM 设置按钮在已保存 Key 下拉右侧且同属 profile 行', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);
    await page.locator('#popupLlmRouteDirect').check();
    const row = page.locator('#popupLlmProfileRow');
    const select = page.locator('#popupLlmProfileSelect');
    const settings = page.locator('#btnToggleLlmSettings');
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(select).toBeVisible();
    await expect(settings).toBeVisible();

    const inRow = await settings.evaluate((el) => !!el.closest('#popupLlmProfileRow'));
    expect(inRow).toBe(true);

    const selectBox = await select.boundingBox();
    const settingsBox = await settings.boundingBox();
    expect(selectBox, '下拉应有几何框').toBeTruthy();
    expect(settingsBox, '设置按钮应有几何框').toBeTruthy();
    expect(settingsBox.x).toBeGreaterThan(selectBox.x);
    // 同行：设置垂直中心落在下拉高度范围内（防 CSS 把按钮甩回标题行）
    const selectMidY = selectBox.y + selectBox.height / 2;
    expect(selectMidY).toBeGreaterThanOrEqual(settingsBox.y - 1);
    expect(selectMidY).toBeLessThanOrEqual(settingsBox.y + settingsBox.height + 1);
  });

  // OPT-20261002-021：非 direct 时整行（含设置）隐藏。
  test('非 direct 路由时已保存 Key 行（含设置）隐藏', async ({ page }) => {
    await installChromeStub(page);
    await page.goto(POPUP_URL);
    await expect(page.locator('#popupLlmRouteSaas')).toBeChecked();
    await expect(page.locator('#popupLlmProfileRow')).toBeHidden();
    await expect(page.locator('#btnToggleLlmSettings')).toBeHidden();

    await page.locator('#popupLlmRouteDirect').check();
    await expect(page.locator('#popupLlmProfileRow')).toBeVisible();
    await expect(page.locator('#btnToggleLlmSettings')).toBeVisible();

    await page.locator('#popupLlmRouteSaas').check();
    await expect(page.locator('#popupLlmProfileRow')).toBeHidden();
    await expect(page.locator('#btnToggleLlmSettings')).toBeHidden();
  });

  // OPT-20261002-020：调用方式切换端到端（未登录 + builtin stub）。
  test('调用方式切换：direct/builtin 隐藏工作空间；saas 未登录显示请先登录', async ({ page }) => {
    await installChromeStub(page, { languageModel: true });
    await page.goto(POPUP_URL);
    await expect(page.locator('#pageAdvisorLlmSection')).toBeVisible({ timeout: 10000 });
    const workspaceRow = page.locator('#popupSaasWorkspaceRow');
    const workspaceSelect = page.locator('#popupSaasWorkspace');

    // 默认调用平台后端：未登录行可见，占位「请先登录」
    await expect(page.locator('#popupLlmRouteSaas')).toBeChecked();
    await expect(page.locator('#popupLlmRouteSystem')).toHaveCount(0);
    await expect(page.locator('#popupLlmSystemSkuRow')).toBeVisible();
    await expect(workspaceRow).toBeVisible();
    await expect(workspaceRow).toContainText('工作空间');
    await expect(workspaceSelect).toBeDisabled();
    await expect(workspaceSelect).toContainText(/请先登录|Sign in first/);
    await expect(workspaceSelect.locator('option')).toHaveCount(1);

    // builtin：工作空间再隐藏（LanguageModel stub 露出单选）
    await expect(page.locator('#popupLlmRouteBuiltinWrap')).toBeVisible({ timeout: 10000 });
    await page.locator('#popupLlmRouteBuiltin').check();
    await expect(workspaceRow).toBeHidden();

    // 切回 direct：仍隐藏
    await page.locator('#popupLlmRouteDirect').check();
    await expect(workspaceRow).toBeHidden();
  });

  // OPT-20261002-020：saas 已登录加载下拉（须先点「调用平台后端」）。
  test('登录后选择「调用平台后端」出现工作空间下拉', async ({ page }) => {
    await installChromeStub(page, { token: 'at_e2e_workspace', username: 'ada' });
    await page.goto(POPUP_URL);
    await expect(page.locator('#pageAdvisorLlmSection')).toBeVisible({ timeout: 10000 });
    const row = page.locator('#popupSaasWorkspaceRow');
    // 已登录默认调用平台后端，工作空间行直接可见
    await expect(page.locator('#popupLlmRouteSaas')).toBeChecked();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#popupLlmSystemSkuRow')).toBeVisible();
    // 分组名以 <optgroup label> 呈现，原生 select 的 textContent 不含该属性 → 按 optgroup 断言。
    await expect(page.locator('#popupLlmSystemSku optgroup[label="自有智能体"]')).toHaveCount(1);
    await expect(page.locator('#popupLlmSystemSku optgroup[label="系统智能体"]')).toHaveCount(1);
    await expect(page.locator('#popupLlmSystemSku')).toContainText('公司主账号*deepseek-chat');
    await expect(page.locator('#popupLlmSystemSku')).toContainText('系统甲');
    await expect(row).toContainText('工作空间');
    const select = page.locator('#popupSaasWorkspace');
    await expect(select).toBeEnabled();
    await expect(select.locator('option')).toHaveCount(3, { timeout: 10000 });
    await expect(select).toContainText('空间A');
    await expect(select).toContainText('空间B');
    await select.selectOption('ws-a');
    const saved = await page.evaluate(async () => {
      const raw = await chrome.storage.local.get(['lastWorkspaceId']);
      return raw.lastWorkspaceId;
    });
    expect(saved).toBe('ws-a');

    // 侧栏宽度下，工作空间下拉与「调用平台后端」同一行，且在智能体下拉之上。
    await page.setViewportSize({ width: 720, height: 900 });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-taskplugin-host', 'sidepanel');
    });
    const radioBox = await page.locator('#popupLlmRouteSaas').boundingBox();
    const wsBox = await page.locator('#popupSaasWorkspace').boundingBox();
    const skuBox = await page.locator('#popupLlmSystemSku').boundingBox();
    expect(radioBox, '调用平台后端单选应有几何框').toBeTruthy();
    expect(wsBox, '工作空间下拉应有几何框').toBeTruthy();
    expect(skuBox, '智能体下拉应有几何框').toBeTruthy();
    expect(wsBox.x).toBeGreaterThan(radioBox.x + radioBox.width - 2);
    const radioMid = radioBox.y + radioBox.height / 2;
    expect(radioMid).toBeGreaterThanOrEqual(wsBox.y - 2);
    expect(radioMid).toBeLessThanOrEqual(wsBox.y + wsBox.height + 2);
    expect(skuBox.y).toBeGreaterThan(wsBox.y);
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
    await expect(page.locator('#popupSkillRadio_none')).toHaveCount(0);
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
    await page.locator('#popupLlmRouteDirect').check();
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

  test('多组直连 Key：下拉切回上一组会真的写入当前 Key', async ({ page }) => {
    // OPT-20260926-009：纯函数只覆盖存储函数，测不到「选择下拉项」是否真的调用
    // activateProfile —— 弹窗回归时可能只更新表单、不写当前组。
    // 用合成 Key，避免断言失败信息带出真实密钥。
    const keyA = 'e2e-key-a-1';
    const keyB = 'e2e-key-b-2';

    await installChromeStub(page);
    await page.goto(POPUP_URL);
    await expect(page.locator('#pageAdvisorLlmSection')).toBeVisible({ timeout: 10000 });
    await page.locator('#popupLlmRouteDirect').check();

    const toggle = page.locator('#btnToggleLlmSettings');
    const fields = page.locator('#pageAdvisorLlmFields');
    const select = page.locator('#popupLlmProfileSelect');

    /** 展开设置 → 新建一组（下拉选「新建」）→ 填写并保存，保存后自动收起。 */
    const saveNewProfile = async (name, key) => {
      await toggle.click();
      await expect(fields).toBeVisible();
      await select.selectOption('');
      await page.locator('#popupLlmProfileName').fill(name);
      await page.locator('#popupLlmBaseUrl').fill('https://api.deepseek.com/v1');
      await page.locator('#popupLlmModel').fill('deepseek-chat');
      await page.locator('#popupLlmApiKey').fill(key);
      await page.locator('#btnSaveLlmConfig').click();
      await expect(page.locator('#popupLlmStatus')).toContainText(/已保存|saved/i);
      await expect(fields).toBeHidden();
    };

    await saveNewProfile('e2e-key-a', keyA);
    await saveNewProfile('e2e-key-b', keyB);

    // 后保存的一组成为当前组，镜像字段应指向它
    expect(await currentStoredApiKey(page)).toBe(keyB);

    // 按 label 取回第一组的 profileId（不依赖下拉项文案里的 Key 尾巴）
    const idA = await page.evaluate(async () => {
      const raw = await chrome.storage.local.get(['pageAdvisorLlmProfiles']);
      const list = Array.isArray(raw?.pageAdvisorLlmProfiles) ? raw.pageAdvisorLlmProfiles : [];
      return String(list.find((p) => p && p.label === 'e2e-key-a')?.id || '');
    });
    expect(idA).not.toBe('');

    await toggle.click();
    await expect(fields).toBeVisible();
    await select.selectOption(idA);
    await expect(page.locator('#popupLlmStatus')).toContainText(/已切换|switched/i);
    expect(await currentStoredApiKey(page)).toBe(keyA);
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
