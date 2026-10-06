'use strict';

/**
 * 「调用平台后端」智能体下拉：自有 + 系统 SKU；无独立「调用系统智能体」单选。
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
  buildPlatformAgentMenu,
  encodePlatformAgentValue,
  parsePlatformAgentValue,
  OWN_VALUE,
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

describe('Popup 平台后端智能体下拉', () => {
  it('下拉紧挨在「调用平台后端」之后，且无独立系统智能体单选', () => {
    const llm = llmSection();
    const saas = llm.indexOf('id="popupLlmRouteSaas"');
    const row = llm.indexOf('id="popupLlmSystemSkuRow"');
    assert.ok(saas >= 0, '缺少调用平台后端单选');
    assert.doesNotMatch(llm, /id="popupLlmRouteSystem"/);
    assert.doesNotMatch(llm, /data-i18n="paLlmRouteSystem"/);
    assert.ok(row > saas, '智能体行应在调用平台后端之后');
    assert.match(llm, /id="popupLlmSystemSku"/);
    assert.match(llm, /data-i18n="paLlmPlatformAgent"/);
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
    assert.match(llmCfg, /route === 'saas' \|\| route === 'system'/);
    const sw = fs.readFileSync(path.join(ROOT, 'background/sw-messages-session.js'), 'utf8');
    assert.match(sw, /case 'getSystemAgents'/);
    assert.match(sw, /listTenantSystemAgents/);
    const ownSw = fs.readFileSync(path.join(ROOT, 'background/sw-messages-own-agents.js'), 'utf8');
    assert.match(sw, /case 'getOwnAgents'/);
    assert.match(ownSw, /getWorkspaceFeatureParamsSummary/);
  });

  it('uiMode：saas 与 system 均显示；未登录 login_required；已登录 menu', () => {
    assert.equal(systemSkuUiMode(false, 'direct'), 'hidden');
    assert.equal(systemSkuUiMode(true, 'direct'), 'hidden');
    assert.equal(systemSkuUiMode(false, 'builtin'), 'hidden');
    assert.equal(systemSkuUiMode(false, 'saas'), 'login_required');
    assert.equal(systemSkuUiMode(true, 'saas'), 'menu');
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

  it('下拉同时含自有智能体与系统 SKU，并恢复上次系统选择', () => {
    assert.equal(OWN_VALUE, 'own');
    assert.equal(encodePlatformAgentValue('saas', ''), 'own');
    assert.equal(encodePlatformAgentValue('system', 'sku-b'), 'system:sku-b');
    assert.deepEqual(parsePlatformAgentValue('own'), {
      routeMode: 'saas', systemSkuId: '', ownProvider: '', ownModel: '',
    });
    assert.deepEqual(parsePlatformAgentValue('system:sku-b'), {
      routeMode: 'system', systemSkuId: 'sku-b', ownProvider: '', ownModel: '',
    });

    const many = buildPlatformAgentMenu(
      [{ id: 'sku-a', name: 'A' }, { id: 'sku-b', name: 'B' }],
      'system',
      'sku-b',
      { own: '自有智能体', ownGroup: '自有智能体', systemGroup: '系统智能体' },
    );
    assert.deepEqual(many.options.map((o) => o.id), ['own', 'system:sku-a', 'system:sku-b']);
    assert.equal(many.options[0].group, '自有智能体');
    assert.equal(many.options[1].group, '系统智能体');
    assert.equal(many.selectedId, 'system:sku-b');

    const own = buildPlatformAgentMenu([{ id: 'sku-a', name: 'A' }], 'saas', '', {});
    assert.equal(own.selectedId, 'own');

    const legacy = buildSystemSkuMenu([{ id: 'sku-only', name: '唯一' }], 'sku-only');
    assert.equal(legacy.selectedId, 'system:sku-only');
  });

  it('自有智能体选项显示 模型*供应商备注，供应商名称', () => {
    const {
      formatOwnAgentOptionLabel,
      collectOwnAgentOptions,
      encodeOwnAgentValue,
    } = require('../lib/popup-system-sku.js');
    assert.equal(formatOwnAgentOptionLabel('deepseek-chat', '公司主账号', 'deepseek'), 'deepseek-chat*公司主账号，deepseek');
    assert.equal(formatOwnAgentOptionLabel('gpt-4.1', '', 'openai'), 'gpt-4.1*openai');
    assert.equal(formatOwnAgentOptionLabel('m1', '备注', ''), 'm1*备注');
    assert.equal(formatOwnAgentOptionLabel('m1', '', ''), 'm1');

    const ownOpts = collectOwnAgentOptions({
      page_advisor_override: true,
      page_advisor_providers: [{
        provider: 'deepseek',
        remark: '公司主账号',
        supported_models: ['deepseek-chat', 'deepseek-reasoner'],
      }],
      providers: [{ provider: 'openai', remark: '忽略', supported_models: ['gpt-4.1'] }],
    });
    assert.deepEqual(ownOpts.map((o) => o.label), [
      'deepseek-chat*公司主账号，deepseek',
      'deepseek-reasoner*公司主账号，deepseek',
    ]);
    assert.equal(ownOpts[0].id, encodeOwnAgentValue('deepseek', 'deepseek-chat'));

    const fromCompanyDefault = collectOwnAgentOptions({
      use_company_default: true,
      providers: [],
      company_config: {
        providers: [{ provider: 'openai', remark: '备用', supported_models: 'gpt-4.1' }],
      },
    });
    assert.equal(fromCompanyDefault[0].label, 'gpt-4.1*备用，openai');

    const encoded = encodeOwnAgentValue('deepseek', 'deepseek-chat');
    assert.deepEqual(parsePlatformAgentValue(encoded), {
      routeMode: 'saas',
      systemSkuId: '',
      ownProvider: 'deepseek',
      ownModel: 'deepseek-chat',
    });
    assert.equal(encodePlatformAgentValue('saas', '', 'deepseek', 'deepseek-chat'), encoded);

    const menu = buildPlatformAgentMenu(
      [{ id: 'sku-a', name: 'A' }],
      'saas',
      '',
      { ownGroup: '自有智能体', systemGroup: '系统智能体' },
      ownOpts,
    );
    assert.equal(menu.options[0].label, 'deepseek-chat*公司主账号，deepseek');
    assert.equal(menu.options[0].group, '自有智能体');
    assert.equal(menu.selectedId, encoded);
    assert.ok(!menu.options.some((o) => o.id === 'own' && o.label === '自有智能体'));
  });

  it('文案：请先登录后再选择平台智能体', () => {
    const { I18N_SCRIPT_RELS } = require('./helpers/txRuntime.js');
    const merged = { zh: {}, en: {} };
    for (const rel of I18N_SCRIPT_RELS) {
      const mod = require(path.join('..', rel));
      if (!mod || !mod.zh || !mod.en) continue;
      Object.assign(merged.zh, mod.zh);
      Object.assign(merged.en, mod.en);
    }
    assert.equal(merged.zh.paLlmPlatformAgent, '智能体');
    assert.equal(merged.zh.paLlmOwnAgent, '自有智能体');
    assert.equal(merged.zh.paLlmSystemAgentGroup, '系统智能体');
    assert.equal(merged.zh.paLlmSystemNeedLogin, '请先登录后再选择平台智能体');
    assert.equal(merged.en.paLlmSystemNeedLogin, 'Sign in first, then pick a platform agent');
    assert.ok(!merged.zh.paLlmRouteSystem);
  });
});
