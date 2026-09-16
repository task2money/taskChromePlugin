/**
 * 生产/预发登录页 E2E：勾选合并后的 legal consent（login-accept-all）及旧 testid 回退。
 * 与 taskFE/tests/playwrightLogin.js 行为对齐，避免 taskChromePlugin 依赖 taskFE 路径。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ email: string; password: string; baseURL: string }} opts
 */
async function webLoginWithLegalAccept(page, { email, password, baseURL }) {
  const root = String(baseURL).replace(/\/$/, '');
  await page.goto(`${root}/auth/login/`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const emailPwdTab = page.getByRole('button', { name: /邮箱\/密码|邮箱.*密码/ }).first();
  if (await emailPwdTab.isVisible().catch(() => false)) {
    await emailPwdTab.click();
    await page.waitForTimeout(300);
  }

  await page.locator('#email').waitFor({ state: 'visible', timeout: 30000 });

  const checkboxCandidates = [
    page.getByTestId('login-accept-all'),
    page.getByTestId('login-privacy-accept'),
    page.getByTestId('login-license-accept'),
    page.getByTestId('login-terms-accept'),
  ];
  for (const checkbox of checkboxCandidates) {
    if (!(await checkbox.isVisible().catch(() => false))) continue;
    if (!(await checkbox.isChecked().catch(() => false))) {
      await checkbox.check({ force: true }).catch(() => {});
    }
  }

  await page.locator('#email').fill(email);
  await page.locator('#email-password, #password').first().fill(password);

  const loginBtn = page.getByRole('button', { name: '登录', exact: true });
  for (let i = 0; i < 60; i++) {
    if (await loginBtn.isEnabled().catch(() => false)) break;
    await page.waitForTimeout(500);
  }

  const authResponsePromise = page.waitForResponse(
    (r) => /\/api\/auth\/?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    { timeout: 120000 },
  );

  await page.locator('form').first().evaluate((form) => form.requestSubmit());

  const authResp = await authResponsePromise;
  const status = authResp.status();
  if (status >= 400) {
    const body = (await authResp.text().catch(() => '')).slice(0, 400);
    throw new Error(`登录 API 返回 ${status}：${body}`);
  }

  // SPA may not fire a full "load" after cookie login — wait for URL only.
  await page.waitForFunction(
    () => !window.location.pathname.includes('/auth/login'),
    null,
    { timeout: 60000 },
  );
}

module.exports = { webLoginWithLegalAccept };
