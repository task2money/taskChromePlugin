/**
 * Popup「提示词 Skill」系统默认目录：未登录文案 vs 已注入会话后自动选中。
 *
 * 运行：bash e2e/popup-catalog-default-skill.playwright.test.js.sh
 */
const fs = require('fs');
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
const T = (ms) => new Promise((r) => setTimeout(r, ms));
const CATALOG_TITLE = '系统默认自动创新';

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

async function skillSnapshot(popup) {
  const settings = popup.locator('#btnToggleSkillSettings');
  if (await settings.isVisible().catch(() => false)) {
    const expanded = await settings.getAttribute('aria-expanded');
    if (expanded !== 'true') await settings.click();
  }
  return popup.evaluate(() => ({
    loginBtn: document.querySelector('#btnToggleLogin')?.style?.display || '',
    headerUser: (document.querySelector('#headerUser')?.textContent || '').trim(),
    summary: (document.querySelector('#popupSkillActiveSummary')?.textContent || '').trim(),
    status: (document.querySelector('#popupSkillStatus')?.textContent || '').trim(),
    listText: (document.querySelector('#popupSkillList')?.innerText || '').trim(),
    sectionDisplay: document.querySelector('#pageAdvisorSkillSection')?.style?.display || '',
  }));
}

test.describe('Popup 系统默认 Skill 目录', () => {
  test('未登录：摘要未应用且状态为 Signed out / 未登录', async () => {
    test.setTimeout(90_000);
    const { chromium } = loadPlaywrightTest();
    const context = await launchExtensionContext(chromium, ROOT, { headless: false });
    try {
      const sw = await waitSw(context);
      expect(sw, 'SW 应启动').toBeTruthy();
      const extId = new URL(sw.url()).hostname;
      const popup = await openPopup(context, extId);
      const snap = await skillSnapshot(popup);
      expect(snap.sectionDisplay, JSON.stringify(snap)).not.toBe('none');
      expect(snap.summary).toMatch(/No skill applied|当前未应用 Skill/);
      expect(snap.status).toMatch(/Signed out: skills stay on this device|未登录：Skill 仅保存在本机/);
      expect(snap.listText).toMatch(/Do not apply a skill|不应用 Skill/);
      expect(snap.listText).toMatch(/自定义|Custom|无障碍|Accessibility/);
      expect(snap.listText).not.toMatch(/系统默认自动创新|系统默认·无障碍/);
      expect(snap.headerUser).not.toMatch(/e2e-user/);
    } finally {
      await context.close();
    }
  });

  test('注入会话后拦截目录 GET 并选中 is_default Skill', async () => {
    test.setTimeout(90_000);
    const { chromium } = loadPlaywrightTest();
    const context = await launchExtensionContext(chromium, ROOT, { headless: false });
    const catalogHits = [];
    await context.route('**/api/page-advisor/v1/system-prompt-skills/**', async (route) => {
      const hdrs = route.request().headers();
      catalogHits.push({
        hasAuth: !!(hdrs.authorization || hdrs.Authorization),
        url: route.request().url(),
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          skills: [{
            id: 'sys_default_auto_innovate',
            title: CATALOG_TITLE,
            tendency: 'custom',
            body: 'platform default',
            is_default: true,
          }],
        }),
      });
    });
    await context.route('**/api/page-advisor/v1/tenant_id/**/prompt-skills/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ skills: [], active_skill_id: '', revision: 'e2e' }),
      });
    });
    try {
      const sw = await waitSw(context);
      expect(sw, 'SW 应启动').toBeTruthy();
      const extId = new URL(sw.url()).hostname;
      await sw.evaluate(async () => {
        const now = Math.floor(Date.now() / 1000);
        await chrome.storage.local.set({
          baseUrl: 'https://saas.example',
          token: 'at_e2e_catalog',
          tokenExpiresAt: now + 3600,
          tokenIssuedAt: now,
          username: 'e2e-user',
          userId: '42',
        });
      });
      const popup = await openPopup(context, extId);
      const settings = popup.locator('#btnToggleSkillSettings');
      if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
      await popup.locator('#popupSkillList [data-tendency="custom"]').click({ timeout: 15000 });
      await popup.waitForFunction(
        (title) => (document.querySelector('#popupSkillList')?.innerText || '').includes(title),
        CATALOG_TITLE,
        { timeout: 15000 },
      ).catch(() => {});
      const snap = await skillSnapshot(popup);
      expect(catalogHits.length, `catalogHits=${JSON.stringify(catalogHits)} snap=${JSON.stringify(snap)}`).toBeGreaterThan(0);
      expect(catalogHits[0].hasAuth).toBe(true);
      expect(snap.listText).toContain(CATALOG_TITLE);
      expect(snap.headerUser).toMatch(/e2e-user/);
      expect(snap.status).not.toMatch(/Signed out: skills stay on this device|未登录：Skill 仅保存在本机/);
    } finally {
      await context.close();
    }
  });
});
