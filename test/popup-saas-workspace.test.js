'use strict';

/**
 * 网页优化设置区：仅登录可见的工作空间下拉。
 * 调用方式 / 直连 Key / 内置模型 / 智能体 / 提示词 Skill 已从 popup 删除。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const {
  pageAdvisorWorkspaceUiMode,
  saasWorkspaceVisible,
  buildSaasWorkspaceMenu,
  applySaasWorkspaceRow,
} = require('../lib/popup-saas-workspace.js');

function popupHtml() {
  return fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
}

describe('Popup 网页优化设置区：工作空间', () => {
  it('只有工作空间区；旧调用方式 / Skill 区与控件已删除', () => {
    const html = popupHtml();
    assert.doesNotMatch(html, /id="pageAdvisorLlmSection"/);
    assert.doesNotMatch(html, /id="pageAdvisorSkillSection"/);
    assert.doesNotMatch(html, /id="popupLlmRouteSaas"/);
    assert.doesNotMatch(html, /id="popupSaasWorkspaceRow"/);
    const m = html.match(/id="pageAdvisorWorkspaceSection"[\s\S]*?<\/section>/);
    assert.ok(m, '缺少 pageAdvisorWorkspaceSection');
    const section = m[0];
    assert.match(section, /id="popupPageAdvisorWorkspace"/);
    assert.match(section, /id="popupPageAdvisorWorkspaceStatus"/);
    assert.match(section, /id="popupPageAdvisorWorkspaceRetry"[^>]*\bhidden\b/);
    assert.match(section, /data-i18n="paSaasWorkspaceLabel"/);
    assert.match(html, /id="pageAdvisorWorkspaceSection"[^>]*style="display:none"/);
  });

  it('popup.html 先加载纯函数再加载控制器；登录流程经 setLoggedIn 驱动', () => {
    const html = popupHtml();
    const libAt = html.indexOf('<script src="../lib/popup-saas-workspace.js"></script>');
    const uiAt = html.indexOf('<script src="popup-saas-workspace.js"></script>');
    const authAt = html.indexOf('<script src="popup-auth.js"></script>');
    assert.ok(libAt >= 0 && uiAt > libAt && authAt > uiAt);
    const auth = fs.readFileSync(path.join(ROOT, 'popup/popup-auth.js'), 'utf8');
    assert.match(auth, /PopupSaasWorkspace\?\.setLoggedIn/);
    assert.doesNotMatch(html, /lib\/popup-system-sku\.js/);
    assert.doesNotMatch(html, /popup-llm-config\.js/);
  });

  it('uiMode：未登录 hidden，登录后 menu', () => {
    assert.equal(pageAdvisorWorkspaceUiMode(false), 'hidden');
    assert.equal(pageAdvisorWorkspaceUiMode(true), 'menu');
    assert.equal(saasWorkspaceVisible(false), false);
    assert.equal(saasWorkspaceVisible(true), true);
    assert.notEqual(pageAdvisorWorkspaceUiMode(false), 'login_required');
    assert.notEqual(pageAdvisorWorkspaceUiMode(true), 'login_required');

    const row = { hidden: false, style: { display: '' } };
    applySaasWorkspaceRow(row, 'hidden');
    assert.equal(row.hidden, true);
    assert.equal(row.style.display, 'none');
    applySaasWorkspaceRow(row, 'menu');
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

  it('手动切换只记手选，不再重载智能体下拉', () => {
    const src = fs.readFileSync(path.join(ROOT, 'popup/popup-saas-workspace.js'), 'utf8');
    assert.doesNotMatch(src, /reloadAgentMenu/);
    assert.doesNotMatch(src, /PopupSystemSku/);
    assert.match(src, /sel\.addEventListener\('change'[\s\S]*?persist\(id, \{ manual: true \}\);/);
  });

  it('文案：工作空间 / 重试 / 未登录占位在 popup 文案包（zh + en）', () => {
    const { zh, en } = require('../lib/i18n-popup-messages.js');
    assert.equal(zh.paSaasWorkspaceLabel, '工作空间');
    assert.equal(en.paSaasWorkspaceLabel, 'Workspace');
    assert.equal(zh.paSaasWorkspaceRetry, '重试');
    assert.equal(en.paSaasWorkspaceRetry, 'Retry');
    assert.equal(zh.paSaasWorkspaceNeedLogin, '-- 请先登录 --');
    assert.equal(en.paSaasWorkspaceNeedLogin, '-- Sign in first --');
  });
});
