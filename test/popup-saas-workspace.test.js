'use strict';

/**
 * 登录后，「调用平台后端」下方出现工作空间下拉；未登录不显示。
 * 选中值写入 lastWorkspaceId，供 Alt+Z / Alt+Shift+Z 走平台后端。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const {
  saasWorkspaceVisible,
  buildSaasWorkspaceMenu,
  applySaasWorkspaceRow,
} = require('../lib/popup-saas-workspace.js');

function popupHtml() {
  return fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
}

function llmSection() {
  const html = popupHtml();
  const m = html.match(/id="pageAdvisorLlmSection"[\s\S]*?<\/section>/);
  assert.ok(m, '缺少 pageAdvisorLlmSection');
  return m[0];
}

describe('Popup 平台后端工作空间下拉', () => {
  it('下拉紧挨在「调用平台后端」之后，且默认隐藏', () => {
    const llm = llmSection();
    const saas = llm.indexOf('id="popupLlmRouteSaas"');
    const row = llm.indexOf('id="popupSaasWorkspaceRow"');
    const profile = llm.indexOf('id="popupLlmProfileRow"');
    assert.ok(saas >= 0, '缺少调用平台后端单选');
    assert.ok(row > saas, '工作空间下拉应在调用平台后端之后');
    assert.ok(profile > row, '工作空间下拉应在已保存 Key 之前');
    assert.match(llm, /id="popupSaasWorkspace"/);
    assert.match(llm, /data-i18n="paSaasWorkspaceLabel"/);
    assert.match(llm, /id="popupSaasWorkspaceRow"[^>]*\bhidden\b/);
    assert.match(llm, /id="popupSaasWorkspaceRow"[^>]*style="display:none"/);
    assert.doesNotMatch(llm, /id="pageAdvisorDefaultsSection"/);
    assert.doesNotMatch(llm, /id="popupDefaultWorkspace"/);
  });

  it('popup.html 加载菜单纯函数与弹窗控制器，登录态切换调用 setLoggedIn', () => {
    const html = popupHtml();
    const libAt = html.indexOf('../lib/popup-saas-workspace.js');
    const uiAt = html.indexOf('popup-saas-workspace.js');
    const authAt = html.indexOf('popup-auth.js');
    assert.ok(libAt >= 0 && uiAt > libAt && authAt > uiAt);
    const auth = fs.readFileSync(path.join(ROOT, 'popup/popup-auth.js'), 'utf8');
    const loginFn = auth.slice(auth.indexOf('function showLoginUI'), auth.indexOf('function showTokenExpiredUI'));
    const loggedFn = auth.slice(auth.indexOf('function showLoggedInUI'), auth.indexOf('function refreshPopupLocaleFromProfile'));
    const expiredFn = auth.slice(auth.indexOf('function showTokenExpiredUI'), auth.indexOf('function refreshPopupLocaleFromProfile'));
    assert.match(loginFn, /PopupSaasWorkspace\.setLoggedIn\(false\)/);
    assert.match(loggedFn, /PopupSaasWorkspace\.setLoggedIn\(true\)/);
    assert.match(expiredFn, /PopupSaasWorkspace\.setLoggedIn\(false\)/);
  });

  it('未登录隐藏，登录后显示', () => {
    assert.equal(saasWorkspaceVisible(false), false);
    assert.equal(saasWorkspaceVisible(true), true);
    const row = { hidden: false, style: { display: '' } };
    applySaasWorkspaceRow(row, false);
    assert.equal(row.hidden, true);
    assert.equal(row.style.display, 'none');
    applySaasWorkspaceRow(row, true);
    assert.equal(row.hidden, false);
    assert.equal(row.style.display, '');
  });

  it('恢复上次工作空间；仅一个空间时自动选中并要求落盘', () => {
    const many = buildSaasWorkspaceMenu(
      [{ id: 'ws-a', name: 'A' }, { id: 'ws-b', name: 'B' }],
      'ws-b',
      ['空间A', '空间B'],
    );
    assert.deepEqual(many.options.map((o) => o.label), ['空间A', '空间B']);
    assert.equal(many.selectedId, 'ws-b');
    assert.equal(many.persist, false);

    const none = buildSaasWorkspaceMenu(
      [{ id: 'ws-a' }, { id: 'ws-b' }],
      '',
      ['空间A', '空间B'],
    );
    assert.equal(none.selectedId, '');
    assert.equal(none.persist, false);

    const only = buildSaasWorkspaceMenu([{ id: 'ws-only' }], '', ['唯一空间']);
    assert.equal(only.selectedId, 'ws-only');
    assert.equal(only.persist, true);

    const already = buildSaasWorkspaceMenu([{ id: 'ws-only' }], 'ws-only', ['唯一空间']);
    assert.equal(already.selectedId, 'ws-only');
    assert.equal(already.persist, false);
  });

  it('文案：工作空间，且 altZHint 指向调用平台后端下的选择', () => {
    const { I18N_SCRIPT_RELS } = require('./helpers/txRuntime.js');
    const merged = { zh: {}, en: {} };
    for (const rel of I18N_SCRIPT_RELS) {
      const mod = require(path.join('..', rel));
      if (!mod || !mod.zh || !mod.en) continue;
      Object.assign(merged.zh, mod.zh);
      Object.assign(merged.en, mod.en);
    }
    assert.equal(merged.zh.paSaasWorkspaceLabel, '工作空间');
    assert.equal(merged.en.paSaasWorkspaceLabel, 'Workspace');
    assert.match(merged.zh.altZHint, /调用平台后端/);
    assert.match(merged.en.altZHint, /Platform backend/);
    assert.doesNotMatch(merged.zh.altZHint, /此处的默认工作空间/);
  });
});
