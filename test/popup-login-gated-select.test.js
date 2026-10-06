'use strict';

/**
 * OPT-20261006-014：共用「登录门闩下拉」模块。
 *
 * 工作空间下拉与系统智能体 SKU 下拉共用显隐模式、行可见性、请先登录占位与
 * 失败重试控制器（含同步点击锁）。这里断言共用实现本身，以及两处 lib 的委托
 * 与 popup.html / service-worker 的加载顺序。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const {
  DEFAULT_ALLOWED_ROUTES,
  loginGatedUiMode,
  applyGatedRow,
  applyLoginGate,
  createRetryController,
} = require('../lib/popup-login-gated-select.js');

const tick = () => new Promise((resolve) => setImmediate(resolve));

function makeEl(extra = {}) {
  return Object.assign({ hidden: true, disabled: false, textContent: '' }, extra);
}

describe('登录门闩下拉共用模块（OPT-20261006-014）', () => {
  it('loginGatedUiMode：默认只放行 saas/system，未登录为 login_required', () => {
    assert.deepEqual(DEFAULT_ALLOWED_ROUTES, ['saas', 'system']);
    for (const route of ['direct', 'builtin', '', null, undefined, 'other']) {
      assert.equal(loginGatedUiMode(true, route), 'hidden', `route=${route}`);
      assert.equal(loginGatedUiMode(false, route), 'hidden', `route=${route}`);
    }
    assert.equal(loginGatedUiMode(false, 'saas'), 'login_required');
    assert.equal(loginGatedUiMode(true, 'saas'), 'menu');
    assert.equal(loginGatedUiMode(false, 'system'), 'login_required');
    assert.equal(loginGatedUiMode(true, 'system'), 'menu');
    // 自定义放行集合
    assert.equal(loginGatedUiMode(true, 'saas', ['saas']), 'menu');
    assert.equal(loginGatedUiMode(true, 'system', ['saas']), 'hidden');
  });

  it('applyGatedRow / applyLoginGate 切换显隐', () => {
    const row = { hidden: false, style: { display: '' } };
    applyGatedRow(row, 'hidden');
    assert.equal(row.hidden, true);
    assert.equal(row.style.display, 'none');
    applyGatedRow(row, 'login_required');
    assert.equal(row.hidden, false);
    assert.equal(row.style.display, '');
    applyGatedRow(row, 'menu');
    assert.equal(row.hidden, false);

    const hint = { hidden: true };
    const select = { hidden: true };
    applyLoginGate({ hint, select }, 'login_required');
    assert.equal(hint.hidden, false);
    assert.equal(select.hidden, true);
    applyLoginGate({ hint, select }, 'menu');
    assert.equal(hint.hidden, true);
    assert.equal(select.hidden, false);
  });

  it('createRetryController：失败显重试、点重试再拉、同步点击锁、成功收回', async () => {
    const status = makeEl();
    const retryBtn = makeEl({ hidden: true });
    let calls = 0;
    const ctrl = createRetryController({
      retryEl: () => retryBtn,
      statusEl: () => status,
      warnLabel: 'unit',
      load: () => {
        calls += 1;
        return Promise.resolve({ ok: true });
      },
    });

    ctrl.clearStatus();
    assert.equal(retryBtn.hidden, true);

    ctrl.showError(new Error('boom'));
    assert.equal(retryBtn.hidden, false, '失败应露出重试入口');
    assert.match(String(status.textContent), /boom/);

    // 同 tick 连点只触发一次
    ctrl.clearStatus();
    const before = calls;
    ctrl.retry();
    ctrl.retry();
    ctrl.retry();
    await tick();
    assert.equal(calls, before + 1, '同步点击锁应挡住同 tick 连点');

    // 结束后锁释放，还能继续重试
    ctrl.retry();
    await tick();
    assert.equal(calls, before + 2);
    assert.equal(retryBtn.hidden, true, '成功后重试按钮收回');
  });

  it('两处 lib 委托共用实现，popup.html / service-worker 先加载共用模块', () => {
    const wsLib = fs.readFileSync(path.join(ROOT, 'lib/popup-saas-workspace.js'), 'utf8');
    const skuLib = fs.readFileSync(path.join(ROOT, 'lib/popup-system-sku.js'), 'utf8');
    assert.match(wsLib, /require\('\.\/popup-login-gated-select\.js'\)/);
    assert.match(wsLib, /loginGatedUiMode/);
    assert.match(skuLib, /require\('\.\/popup-login-gated-select\.js'\)/);
    assert.match(skuLib, /applyLoginGate/);

    const html = fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
    const shared = html.indexOf('../lib/popup-login-gated-select.js');
    assert.ok(shared >= 0, 'popup.html 应加载共用模块');
    assert.ok(shared < html.indexOf('../lib/popup-saas-workspace.js'));
    assert.ok(shared < html.indexOf('../lib/popup-system-sku.js'));

    const sw = fs.readFileSync(path.join(ROOT, 'background/service-worker.js'), 'utf8');
    const swShared = sw.indexOf("'../lib/popup-login-gated-select.js'");
    assert.ok(swShared >= 0, 'service-worker 应 importScripts 共用模块');
    assert.ok(swShared < sw.indexOf("'../lib/popup-system-sku.js'"));

    const wsUi = fs.readFileSync(path.join(ROOT, 'popup/popup-saas-workspace.js'), 'utf8');
    const skuUi = fs.readFileSync(path.join(ROOT, 'popup/popup-system-sku.js'), 'utf8');
    assert.match(wsUi, /LoginGatedSelect\.createRetryController/);
    assert.match(skuUi, /LoginGatedSelect\.createRetryController/);
  });
});
