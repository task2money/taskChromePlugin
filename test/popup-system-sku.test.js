'use strict';

/**
 * 「调用系统智能体」：未登录提示先登录且不展示下拉；登录后才显示 SKU 菜单。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const {
  systemSkuUiMode,
  applySystemSkuRow,
  applySystemSkuLoginGate,
  buildSystemSkuMenu,
} = require('../lib/popup-system-sku.js');

function popupHtml() {
  return fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
}

function llmSection() {
  const html = popupHtml();
  const m = html.match(/id="pageAdvisorLlmSection"[\s\S]*?<\/section>/);
  assert.ok(m, '缺少 pageAdvisorLlmSection');
  return m[0];
}

describe('Popup 系统智能体登录门闩', () => {
  it('下拉紧挨在「调用系统智能体」之后，且默认隐藏', () => {
    const llm = llmSection();
    const system = llm.indexOf('id="popupLlmRouteSystem"');
    const row = llm.indexOf('id="popupLlmSystemSkuRow"');
    const saas = llm.indexOf('id="popupLlmRouteSaas"');
    assert.ok(saas >= 0 && system > saas, '调用系统智能体应在调用平台后端之后');
    assert.ok(row > system, '系统智能体行应在该单选之后');
    assert.match(llm, /id="popupLlmSystemSku"/);
    assert.match(llm, /data-i18n="paLlmSystemSku"/);
    assert.match(llm, /id="popupLlmSystemSkuRow"[^>]*\bhidden\b/);
    assert.match(llm, /id="popupLlmSystemLoginHint"/);
  });

  it('popup.html 加载纯函数与弹窗控制器；登录态与路由切换均接线', () => {
    const html = popupHtml();
    const libAt = html.indexOf('../lib/popup-system-sku.js');
    const uiAt = html.indexOf('popup/popup-system-sku.js') >= 0
      ? html.indexOf('popup-system-sku.js', libAt + 1)
      : html.indexOf('popup-system-sku.js', libAt + 1);
    const authAt = html.indexOf('popup-auth.js');
    assert.ok(libAt >= 0 && uiAt > libAt && authAt > uiAt);
    const auth = fs.readFileSync(path.join(ROOT, 'popup/popup-auth.js'), 'utf8');
    assert.match(auth, /function setLoginGatedModules/);
    assert.match(auth, /PopupSystemSku\?\.setLoggedIn/);
    assert.match(auth, /function promptLogin/);
    const llmCfg = fs.readFileSync(path.join(ROOT, 'popup/popup-llm-config.js'), 'utf8');
    assert.match(llmCfg, /syncSystemSkuRow/);
    assert.match(llmCfg, /PopupSystemSku\.syncRoute/);
    const sw = fs.readFileSync(path.join(ROOT, 'background/sw-messages-session.js'), 'utf8');
    assert.match(sw, /case 'getSystemAgents'/);
    assert.match(sw, /listTenantSystemAgents/);
  });

  it('uiMode：仅 system 显示；未登录 login_required；已登录 menu', () => {
    assert.equal(systemSkuUiMode(false, 'direct'), 'hidden');
    assert.equal(systemSkuUiMode(true, 'direct'), 'hidden');
    assert.equal(systemSkuUiMode(false, 'saas'), 'hidden');
    assert.equal(systemSkuUiMode(false, 'builtin'), 'hidden');
    assert.equal(systemSkuUiMode(false, 'system'), 'login_required');
    assert.equal(systemSkuUiMode(true, 'system'), 'menu');
  });

  it('login_required 显示提示并隐藏 select；menu 相反', () => {
    const row = { hidden: true, style: { display: 'none' } };
    const hint = { hidden: true };
    const select = { hidden: true };
    applySystemSkuRow(row, 'login_required');
    applySystemSkuLoginGate({ hint, select }, 'login_required');
    assert.equal(row.hidden, false);
    assert.equal(row.style.display, '');
    assert.equal(hint.hidden, false);
    assert.equal(select.hidden, true);

    applySystemSkuRow(row, 'menu');
    applySystemSkuLoginGate({ hint, select }, 'menu');
    assert.equal(hint.hidden, true);
    assert.equal(select.hidden, false);

    applySystemSkuRow(row, 'hidden');
    assert.equal(row.hidden, true);
    assert.equal(row.style.display, 'none');
  });

  it('恢复上次 SKU；仅一个时自动选中', () => {
    const many = buildSystemSkuMenu(
      [{ id: 'sku-a', name: 'A' }, { id: 'sku-b', name: 'B' }],
      'sku-b',
    );
    assert.deepEqual(many.options.map((o) => o.label), ['A', 'B']);
    assert.equal(many.selectedId, 'sku-b');
    assert.equal(many.persist, false);

    const only = buildSystemSkuMenu([{ id: 'sku-only', name: '唯一' }], '');
    assert.equal(only.selectedId, 'sku-only');
    assert.equal(only.persist, true);
  });

  it('文案：请先登录后再选择系统智能体', () => {
    const { I18N_SCRIPT_RELS } = require('./helpers/txRuntime.js');
    const merged = { zh: {}, en: {} };
    for (const rel of I18N_SCRIPT_RELS) {
      const mod = require(path.join('..', rel));
      if (!mod || !mod.zh || !mod.en) continue;
      Object.assign(merged.zh, mod.zh);
      Object.assign(merged.en, mod.en);
    }
    assert.equal(merged.zh.paLlmSystemNeedLogin, '请先登录后再选择系统智能体');
    assert.equal(merged.en.paLlmSystemNeedLogin, 'Sign in first, then pick a system agent');
  });
});
