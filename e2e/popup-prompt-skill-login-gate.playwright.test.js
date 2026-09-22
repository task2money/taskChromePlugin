/**
 * OPT-20260922-029：Popup「提示词 Skill」登录门闩 —— 真实 unpacked 扩展 E2E。
 *
 * 单测（test/popup-prompt-skills.test.js 等）把 `loggedInProvider` / `sessionProvider`
 * 直接注入，绕过了真实的 `getAuthStatus` 消息往返与 `PageAdvisorAPI.init` 时序；
 * 真实扩展下「未登录但已填本机 LLM Key」是否仍会误打 `prompt-skills` 无从覆盖。
 *
 * 本 e2e 用真实扩展验证两条断言：
 *   1. 未登录（仅填本机 LLM Key）→ 弹窗不得发起任何 `prompt-skills` 请求；
 *   2. 注入登录会话后 → 必须发起 `prompt-skills` GET 且携带 Authorization。
 *
 * 两个用例共用同一份工作空间 / 路由夹具，唯一变量是登录态；用例 1 另断言
 * workspaces 端点确实被请求过，从而把「没发 prompt-skills」归因到登录门闩，
 * 而不是「工作空间没解析出来所以本来就不会发」。
 *
 * 运行：bash e2e/popup-prompt-skill-login-gate.playwright.test.js.sh
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
const { launchExtensionContext } = require('./helpers/launchExtensionContext');

const ROOT = path.resolve(__dirname, '..');
const EXT_PATH = ROOT;
const T = (ms) => new Promise((r) => setTimeout(r, ms));

const TENANT_ID = 'tenant-e2e';
const WORKSPACE_ID = 'ws-e2e';
const SIGNED_OUT_STATUS_RE = /Signed out: skills stay on this device|未登录：Skill 仅保存在本机/;

async function waitSw(context) {
  let sw = null;
  for (let i = 0; i < 20 && !sw; i++) {
    sw = context.serviceWorkers()[0] || null;
    if (!sw) await T(500);
  }
  return sw;
}

async function openPopup(context, extId) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
  await popup.locator('#loadingSpinner').waitFor({ state: 'hidden', timeout: 15000 });
  return popup;
}

/**
 * 工作空间夹具：让 `resolveSkillScope()` 能解析出 tenant/workspace，
 * 否则 `loadSkills()` 的 wids 为空，两个用例都会「没有请求」而失去区分度。
 */
async function stubWorkspaceFixture(context, counters) {
  await context.route('**/api/user/*/accounts/users/me/**', async (route) => {
    counters.userMe += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ companies: [{ id: TENANT_ID, name: 'E2E Tenant', is_active: true }] }),
    });
  });
  await context.route('**/api/projects/workspaces/tenant_id/**', async (route) => {
    counters.workspaces += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ id: WORKSPACE_ID, company_id: TENANT_ID, name: 'E2E WS' }] }),
    });
  });
  await context.route('**/api/page-advisor/v1/system-prompt-skills/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ skills: [] }),
    });
  });
  await context.route('**/api/page-advisor/v1/tenant_id/**/prompt-skills/**', async (route) => {
    const hdrs = route.request().headers();
    counters.promptSkills.push({
      hasAuth: !!(hdrs.authorization || hdrs.Authorization),
      url: route.request().url(),
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        skills: [{
          id: 'skill-e2e-cloud',
          title: 'E2E 云端 Skill',
          tendency: 'custom',
          body: 'cloud body',
          syncTarget: WORKSPACE_ID,
        }],
        active_skill_id: '',
        revision: 'e2e-rev-1',
      }),
    });
  });
}

/** 写入「已填本机 LLM Key」的存储项（pageAdvisorLlmApiKey/BaseUrl/Model）。 */
async function seedLocalLlmKey(sw) {
  await sw.evaluate(async () => {
    await chrome.storage.local.set({
      pageAdvisorLlmApiKey: 'sk-local-e2e',
      pageAdvisorLlmBaseUrl: 'https://llm.example',
      pageAdvisorLlmModel: 'e2e-model',
      lastWorkspaceId: 'ws-e2e',
      userId: '42',
    });
  });
}

async function storageSnapshot(popup) {
  return popup.evaluate(async () => {
    const keys = [
      'pageAdvisorLlmApiKey', 'pageAdvisorLlmBaseUrl', 'pageAdvisorLlmModel',
      'token', 'baseUrl', 'lastWorkspaceId',
    ];
    return chrome.storage.local.get(keys);
  });
}

async function skillStatus(popup) {
  const settings = popup.locator('#btnToggleSkillSettings');
  if (await settings.isVisible().catch(() => false)) {
    const expanded = await settings.getAttribute('aria-expanded');
    if (expanded !== 'true') await settings.click();
  }
  return popup.evaluate(() => ({
    status: (document.querySelector('#popupSkillStatus')?.textContent || '').trim(),
    listText: (document.querySelector('#popupSkillList')?.innerText || '').trim(),
    headerUser: (document.querySelector('#headerUser')?.textContent || '').trim(),
  }));
}

test.describe('Popup Skill 登录门闩（真实扩展）', () => {
  test('未登录 + 已填本机 Key：不发起 prompt-skills 请求', async () => {
    test.setTimeout(90_000);
    const { chromium } = loadPlaywrightTest();
    const context = await launchExtensionContext(chromium, EXT_PATH, { headless: false });
    const counters = { userMe: 0, workspaces: 0, promptSkills: [] };
    await stubWorkspaceFixture(context, counters);
    try {
      const sw = await waitSw(context);
      expect(sw, '扩展 Service Worker 应启动').toBeTruthy();
      const extId = new URL(sw.url()).hostname;
      await seedLocalLlmKey(sw);

      const popup = await openPopup(context, extId);
      // 等 Skill 区落到「未登录」稳态，再留出静默窗口给任何（潜在的）误发请求落地。
      await popup.waitForFunction(
        (re) => new RegExp(re).test(document.querySelector('#popupSkillStatus')?.textContent || ''),
        SIGNED_OUT_STATUS_RE.source,
        { timeout: 15000 },
      ).catch(() => {});
      await T(1500);

      const stored = await storageSnapshot(popup);
      expect(stored.pageAdvisorLlmApiKey, '夹具：本机 LLM Key 应已填写').toBe('sk-local-e2e');
      expect(stored.pageAdvisorLlmBaseUrl, '夹具：本机 LLM BaseUrl 应已填写').toBe('https://llm.example');
      expect(stored.pageAdvisorLlmModel, '夹具：本机 LLM Model 应已填写').toBe('e2e-model');
      expect(stored.token || '', '夹具：未登录用例不得持有 access token').toBe('');

      // 归因前提：工作空间夹具确实被请求过 —— 否则「没有 prompt-skills」可能只是
      // 因为 workspaceRows 为空导致 wids 为空，而非登录门闩生效。
      expect(
        counters.workspaces,
        `工作空间夹具应被请求（userMe=${counters.userMe}）`,
      ).toBeGreaterThan(0);

      const snap = await skillStatus(popup);
      expect(
        counters.promptSkills,
        `未登录不得请求 prompt-skills，实际=${JSON.stringify(counters.promptSkills)}`,
      ).toHaveLength(0);
      expect(snap.status, JSON.stringify(snap)).toMatch(SIGNED_OUT_STATUS_RE);
      expect(snap.headerUser).not.toMatch(/e2e-user/);
    } finally {
      await context.close();
    }
  });

  test('注入登录会话后：发起 prompt-skills GET 且带 Authorization', async () => {
    test.setTimeout(90_000);
    const { chromium } = loadPlaywrightTest();
    const context = await launchExtensionContext(chromium, EXT_PATH, { headless: false });
    const counters = { userMe: 0, workspaces: 0, promptSkills: [] };
    await stubWorkspaceFixture(context, counters);
    try {
      const sw = await waitSw(context);
      expect(sw, '扩展 Service Worker 应启动').toBeTruthy();
      const extId = new URL(sw.url()).hostname;
      // 与用例 1 同一夹具，仅追加登录态：唯一变量是 token。
      await seedLocalLlmKey(sw);
      await sw.evaluate(async () => {
        const now = Math.floor(Date.now() / 1000);
        await chrome.storage.local.set({
          baseUrl: 'https://saas.example',
          token: 'at_e2e_login_gate',
          tokenExpiresAt: now + 3600,
          tokenIssuedAt: now,
          username: 'e2e-user',
        });
      });

      const popup = await openPopup(context, extId);
      const deadline = Date.now() + 20_000;
      while (!counters.promptSkills.length && Date.now() < deadline) await T(500);

      const snap = await skillStatus(popup);
      expect(
        counters.promptSkills.length,
        `已登录应请求 prompt-skills，实际=${JSON.stringify(counters.promptSkills)} snap=${JSON.stringify(snap)}`,
      ).toBeGreaterThan(0);
      expect(counters.promptSkills[0].hasAuth, 'GET 应携带 Authorization').toBe(true);
      expect(counters.promptSkills[0].url).toContain(`workspace_id/${WORKSPACE_ID}`);
      expect(snap.status, JSON.stringify(snap)).not.toMatch(SIGNED_OUT_STATUS_RE);
    } finally {
      await context.close();
    }
  });
});
