'use strict';

/**
 * 本机模型出售：仅登录后显示；出售项目为下拉而非手输 ID。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const {
  applyEdgeSellSectionVisibility,
  buildEdgeOfferSelectMenu,
  applyEdgeOfferSelect,
  isEdgeSellRegistered,
  applyEdgeSellRegisteredMode,
  formatEdgeSellRegisteredView,
} = require('../lib/popup-builtin-edge-sell.js');

function popupHtml() {
  return fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
}

function edgeSellSection() {
  const html = popupHtml();
  const m = html.match(/id="builtinEdgeSellSection"[\s\S]*?<\/section>/);
  assert.ok(m, '缺少 builtinEdgeSellSection');
  return m[0];
}

describe('Popup 本机模型出售 — 登录可见 + 项目下拉', () => {
  it('区块默认隐藏，使用 select 而非 text input', () => {
    const sec = edgeSellSection();
    assert.match(sec, /id="builtinEdgeSellSection"[^>]*(?:\bhidden\b|style="display:none")/);
    assert.match(sec, /id="builtinEdgeProjectId"/);
    assert.match(sec, /<select[^>]*id="builtinEdgeProjectId"/);
    assert.doesNotMatch(sec, /<input[^>]*id="builtinEdgeProjectId"/);
    assert.match(sec, /data-testid="builtin-edge-project-id"/);
  });

  it('popup.html 加载纯函数库与控制器；auth 在登录态切换时接线', () => {
    const html = popupHtml();
    const libAt = html.indexOf('../lib/popup-builtin-edge-sell.js');
    const uiAt = html.indexOf('popup-builtin-edge-sell.js');
    const authAt = html.indexOf('popup-auth.js');
    assert.ok(libAt >= 0 && uiAt > libAt && authAt > uiAt);

    const auth = fs.readFileSync(path.join(ROOT, 'popup/popup-auth.js'), 'utf8');
    const loginFn = auth.slice(auth.indexOf('function showLoginUI'), auth.indexOf('function showTokenExpiredUI'));
    const loggedFn = auth.slice(auth.indexOf('function showLoggedInUI'), auth.indexOf('function refreshPopupLocaleFromProfile'));
    const expiredFn = auth.slice(auth.indexOf('function showTokenExpiredUI'), auth.indexOf('function refreshPopupLocaleFromProfile'));
    assert.match(auth, /function setLoginGatedModules/);
    assert.match(loginFn, /setLoginGatedModules\(false\)/);
    assert.match(loggedFn, /setLoginGatedModules\(true\)/);
    assert.match(expiredFn, /setLoginGatedModules\(false\)/);
    assert.match(auth, /PopupBuiltinEdgeSell\?\.setLoggedIn/);
  });

  it('applyEdgeSellSectionVisibility：仅 loggedIn 时显示', () => {
    const section = { hidden: false, style: { display: '' } };
    applyEdgeSellSectionVisibility(section, false);
    assert.equal(section.hidden, true);
    assert.equal(section.style.display, 'none');
    applyEdgeSellSectionVisibility(section, true);
    assert.equal(section.hidden, false);
    assert.equal(section.style.display, '');
  });

  it('buildEdgeOfferSelectMenu：占位 + 标题选项；单项目自动选中；paused 后缀', () => {
    const empty = buildEdgeOfferSelectMenu([], '', {
      placeholder: '-- 请选择 --',
      pausedSuffix: '(已暂停)',
    });
    assert.deepEqual(empty.options, [{ id: '', label: '-- 请选择 --' }]);
    assert.equal(empty.selectedId, '');

    const one = buildEdgeOfferSelectMenu(
      [{ id: 'offer-1', title: '家用台式机', status: 'active' }],
      '',
      { placeholder: '-- 请选择 --', pausedSuffix: '(已暂停)' },
    );
    assert.equal(one.selectedId, 'offer-1');
    assert.equal(one.options.length, 2);
    assert.equal(one.options[1].label, '家用台式机');

    const many = buildEdgeOfferSelectMenu(
      [
        { id: 'a', title: 'A', status: 'active' },
        { id: 'b', title: 'B', status: 'paused' },
      ],
      'b',
      { placeholder: '-- 请选择 --', pausedSuffix: '(已暂停)' },
    );
    assert.equal(many.selectedId, 'b');
    assert.equal(many.options[2].label, 'B (已暂停)');
  });

  it('applyEdgeOfferSelect：写入 option 并选中', () => {
    const sel = { innerHTML: '', value: '' };
    applyEdgeOfferSelect(sel, {
      options: [
        { id: '', label: '-- 请选择 --' },
        { id: 'x1', label: '项目甲' },
      ],
      selectedId: 'x1',
    });
    assert.match(sel.innerHTML, /value=""/);
    assert.match(sel.innerHTML, /value="x1"/);
    assert.match(sel.innerHTML, /项目甲/);
    assert.equal(sel.value, 'x1');
  });

  it('控制器从 GET /offers 填充下拉，注册时取 select 值', () => {
    const src = fs.readFileSync(path.join(ROOT, 'popup/popup-builtin-edge-sell.js'), 'utf8');
    assert.match(src, /\/api\/cloud\/v1\/builtin-edge\/offers/);
    assert.match(src, /buildEdgeOfferSelectMenu|PopupBuiltinEdgeSellMenu/);
    assert.match(src, /builtinEdgeProjectId/);
    assert.match(src, /setLoggedIn/);
  });

  it('已注册态：当前注册情况、调用情况、取消注册', () => {
    const sec = edgeSellSection();
    assert.match(sec, /id="builtinEdgeSellRegisteredPanel"/);
    assert.match(sec, /data-i18n="builtinEdgeRegistrationTitle"/);
    assert.match(sec, /data-i18n="builtinEdgeCallStatsTitle"/);
    assert.match(sec, /id="btnBuiltinEdgeUnregister"/);
    assert.match(sec, /data-testid="builtin-edge-unregister"/);

    const view = formatEdgeSellRegisteredView(
      {
        status: 'online',
        inflight: 1,
        max_concurrency: 2,
        dispatch_count: 5,
        success_count: 4,
        error_count: 1,
        last_seen_at: '2026-10-03T01:00:00Z',
        last_dispatch_at: '2026-10-03T01:02:00Z',
        device_label: '书房',
      },
      { projectId: 'p1', nodeId: 'n1', projectTitle: '家用' },
      { labels: { project: '项目', node: '节点', status: '状态', device: '设备', lastSeen: '最近保活', inflight: '进行中', dispatch: '已分派', success: '成功', error: '失败', lastDispatch: '最近分派' } },
    );
    assert.ok(view.registrationLines.some((l) => l.includes('家用')));
    assert.ok(view.callLines.some((l) => l.includes('已分派') && l.includes('5')));

    const register = { hidden: false, style: { display: '' } };
    const registered = { hidden: true, style: { display: 'none' } };
    applyEdgeSellRegisteredMode(register, registered, true);
    assert.equal(register.hidden, true);
    assert.equal(registered.hidden, false);
    assert.equal(isEdgeSellRegistered({ projectId: 'p', nodeId: 'n' }), true);
    assert.equal(isEdgeSellRegistered({ projectId: '', nodeId: 'n' }), false);

    const src = fs.readFileSync(path.join(ROOT, 'popup/popup-builtin-edge-sell.js'), 'utf8');
    assert.match(src, /nodes\/\$\{encodeURIComponent\(nodeId\)\}\/revoke/);
    assert.match(src, /stopBuiltinEdgeTunnel/);
  });
});
