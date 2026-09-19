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
    // 生产实际 id（见 playwright/_opt_harness.cjs 的可用配方）；testid 项保留为历史兼容
    page.locator('#login-legal-consent'),
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

  // 等待提交按钮就绪（OPT-20260918-027）。
  // 原实现：`getByRole('button', {name:'登录', exact:true})` + 60 轮 isEnabled() 轮询。
  // 每轮未命中都要等满 runner 的 actionTimeout(15s)，最坏 60×15.5s ≈ 930s，远超用例
  // 180s 预算；且「精确可访问名 = 登录」一旦按钮改名/加图标/切英文就永久匹配不到，
  // 表现为 oauth e2e 恒超时。改为多候选 + 有界 waitFor——拿不到也不阻塞，
  // 真正的提交走 form.requestSubmit()，只依赖 form 本身。
  const submitCandidates = [
    page.getByTestId('login-submit'),
    page.locator('button[type=submit]'),
    page.getByRole('button', { name: /登录|Sign in/i }),
  ];
  for (const candidate of submitCandidates) {
    const first = candidate.first();
    if (await first.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) {
      await first.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
      break;
    }
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
