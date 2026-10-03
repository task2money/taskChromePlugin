/**
 * 真实扩展：重装（storage 清空）后登录侧栏「本机模型」Tab 自动恢复注册（OPT-20261003-021）
 *
 * 覆盖（真实扩展 + 真实 SW，非 stub）：
 *  (1) 清空 chrome.storage.local（模拟卸载重装）后仅写回登录凭据（baseUrl/token），
 *      不预置 builtinEdgeActiveTunnel
 *  (2) 打开侧栏本机模型 Tab，mock GET offers/nodes（节点 install_fingerprint 与插件
 *      安装指纹一致），断言 restoreRegistrationIfMissing 自动命中：
 *        已注册面板可见 + 注册明细含项目/节点/指纹
 *  (3) 断言 SW 保活已真正拉起：startBuiltinEdgeTunnel 消息 → chrome.alarms 创建
 *      builtinEdgeTunnelKeepalive + 活动隧道已写回 storage
 *  (4) 多节点不误绑：两节点中仅一个指纹匹配时认领匹配节点；两节点均不匹配时不绑定
 *
 * 运行：bash e2e/sidepanel-builtin-edge-restore-reinstall.playwright.test.js.sh
 */
const path = require('path');

function loadPlaywrightTest() {
  try {
    return require('@playwright/test');
  } catch (_) {
    return require(path.resolve(__dirname, '../../task2app/playwright/node_modules/@playwright/test'));
  }
}

const { test, expect } = loadPlaywrightTest();
const { launchExtensionContext } = require('./helpers/launchExtensionContext');

const ROOT = path.resolve(__dirname, '..');
const T = (ms) => new Promise((r) => setTimeout(r, ms));

const API_BASE = 'https://api.edge-sell.test';
const OFFER = { id: 'offer-aaa', title: '家用台式机', status: 'active' };
const DEVICE_LABEL = '柜台主机 A';
const TUNNEL_ALARM = 'builtinEdgeTunnelKeepalive';

/**
 * 启动真实扩展、模拟重装（清空 storage 后仅写回登录凭据）、mock 平台 API 并打开侧栏。
 * @param {(fingerprint: string) => object[]} buildNodes 依据真实安装指纹构造节点列表
 */
async function openRestoreScenario(buildNodes) {
  const { chromium } = loadPlaywrightTest();
  const context = await launchExtensionContext(chromium, ROOT, { headless: false });
  let sw = null;
  for (let i = 0; i < 20 && !sw; i += 1) {
    sw = context.serviceWorkers()[0] || null;
    if (!sw) await T(500);
  }
  expect(sw, '扩展 Service Worker 应启动').toBeTruthy();

  const fingerprint = await sw.evaluate(async (base) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      'aidevpush.locale': 'zh-CN',
      baseUrl: base,
      token: 'test-token',
      userId: 'user-1',
    });
    return globalThis.PluginInstallFingerprint
      .ensurePluginInstallFingerprint(chrome.storage.local);
  }, API_BASE);
  expect(typeof fingerprint).toBe('string');
  expect(fingerprint.length).toBeGreaterThan(0);

  const nodes = buildNodes(fingerprint);
  await context.route('**/api/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const json = (obj, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'X-Trace-Id': 'e2e-trace' },
      body: JSON.stringify(obj),
    });
    if (/\/builtin-edge\/offers\/[^/]+\/nodes$/.test(url) && method === 'GET') {
      await json({ items: nodes });
      return;
    }
    if (/\/builtin-edge\/nodes\/[^/]+\/revoke$/.test(url) && method === 'POST') {
      await json({ ok: true });
      return;
    }
    if (/\/builtin-edge\/tunnel\//.test(url)) {
      await json({ job: null });
      return;
    }
    if (url.includes('/api/cloud/v1/builtin-edge/offers')) {
      await json({ items: [OFFER] });
      return;
    }
    await json({});
  });

  const extensionId = new URL(sw.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
  await page.locator('[data-testid=sp-tab-builtin]').click();

  return { context, sw, page, fingerprint };
}

function edgeNode(id, offerId, fingerprint, label) {
  return {
    id,
    offer_id: offerId,
    status: 'active',
    device_label: label,
    install_fingerprint: fingerprint,
    last_seen_at: '2026-10-03T10:00:00Z',
    supported_models: ['gemini-nano'],
  };
}

test.describe('真实扩展：重装后自动恢复本机模型出售注册', () => {
  test('storage 清空 + 登录 → 侧栏自动恢复注册并拉起 SW 保活', async () => {
    test.setTimeout(120_000);
    const { context, sw, page, fingerprint } = await openRestoreScenario((fp) => [
      edgeNode('node-xyz', OFFER.id, fp, DEVICE_LABEL),
    ]);
    try {
      const registered = page.locator('#builtinEdgeSellRegisteredPanel');
      await expect(registered).toBeVisible({ timeout: 20000 });
      await expect(page.locator('#builtinEdgeSellRegisterPanel')).toBeHidden();

      const regLines = page.locator('#builtinEdgeRegistrationLines');
      await expect(regLines).toContainText('家用台式机');
      await expect(regLines).toContainText('node-xyz');
      await expect(regLines).toContainText(fingerprint);
      await expect(regLines).toContainText(DEVICE_LABEL);

      // SW 保活确已拉起：alarm 已创建 + 活动隧道已写回 storage
      await expect.poll(async () => sw.evaluate(
        async (name) => Boolean(await chrome.alarms.get(name)),
        TUNNEL_ALARM,
      ), { timeout: 15000 }).toBe(true);

      const active = await sw.evaluate(async () =>
        globalThis.BuiltinEdgeTunnel.getActiveBuiltinEdgeTunnel());
      expect(active?.projectId).toBe(OFFER.id);
      expect(active?.nodeId).toBe('node-xyz');
    } finally {
      await context.close();
    }
  });

  test('多节点：仅一个指纹匹配时认领匹配节点，不误绑另一节点', async () => {
    test.setTimeout(120_000);
    const { context, sw, page, fingerprint } = await openRestoreScenario((fp) => [
      edgeNode('node-other', OFFER.id, 'pf_some_other_machine', '另一台主机'),
      edgeNode('node-mine', OFFER.id, fp, DEVICE_LABEL),
    ]);
    try {
      const regLines = page.locator('#builtinEdgeRegistrationLines');
      await expect(regLines).toContainText('node-mine', { timeout: 20000 });
      await expect(regLines).not.toContainText('node-other');

      const active = await sw.evaluate(async () =>
        globalThis.BuiltinEdgeTunnel.getActiveBuiltinEdgeTunnel());
      expect(active?.nodeId).toBe('node-mine');
      expect(active?.projectId).toBe(OFFER.id);
    } finally {
      await context.close();
    }
  });

  test('多节点：均不匹配指纹时不自动绑定（不误绑）', async () => {
    test.setTimeout(120_000);
    const { context, sw, page } = await openRestoreScenario(() => [
      edgeNode('node-a', OFFER.id, 'pf_other_a', '主机 A'),
      edgeNode('node-b', OFFER.id, 'pf_other_b', '主机 B'),
    ]);
    try {
      // 恢复流程不会认领；注册面板保持可见
      await expect(page.locator('#builtinEdgeSellRegisterPanel')).toBeVisible({ timeout: 20000 });
      await expect(page.locator('#builtinEdgeSellRegisteredPanel')).toBeHidden();

      const active = await sw.evaluate(async () =>
        globalThis.BuiltinEdgeTunnel.getActiveBuiltinEdgeTunnel());
      expect(active?.nodeId).toBeUndefined();
    } finally {
      await context.close();
    }
  });
});
