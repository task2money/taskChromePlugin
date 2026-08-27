'use strict';

/**
 * content.js F5 隐藏页跳过 auth 刷新决策回归测试（OPT-20260808-023）
 *
 * 缺陷背景：auth 广播会触发全部标签页的 scheduleAuthRefresh 去抖回调，每页各做
 * checkLoginStatus(full) + loadWorkspaces()（网络请求 + DOM 重建）——多标签页
 * 叠加成跨页放大风暴，是 SW 卡死/内存增长的次要放大器之一。
 * 修复：去抖回调触发时若 document.hidden（后台/最小化标签页）则跳过全量刷新，
 * 打 pendingHiddenRefresh；可见性 tick / 角标定时器按 resolveAuthBadgeTickFollowUp
 * 补跑 full 或 loadWorkspaces，避免「已登录 + 请先登录」分裂。
 *
 * 决策抽为 lib/auth-refresh-debounce.js 纯函数（content.js 经 manifest 注入调用），
 * 测试断言修复后语义：
 * 1. hidden=true → 跳过刷新（修复前隐藏页仍全量刷新）
 * 2. hidden=false → 正常刷新
 * 3. 无 document（沙箱/异常环境）→ 保守不跳过（不确定时刷新，不静默丢登录态）
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldSkipDebouncedAuthRefresh,
  resolveAuthBadgeTickFollowUp,
} = require('../lib/auth-refresh-debounce.js');

describe('shouldSkipDebouncedAuthRefresh（F5 隐藏页跳过决策）', () => {
  it('document.hidden=true（后台/最小化标签页）→ 跳过全量刷新', () => {
    assert.equal(shouldSkipDebouncedAuthRefresh({ hidden: true }), true);
  });

  it('document.hidden=false → 正常刷新（广播后去抖回调继续执行）', () => {
    assert.equal(shouldSkipDebouncedAuthRefresh({ hidden: false }), false);
  });

  it('hidden 未定义/undefined → 不跳过（保守刷新）', () => {
    assert.equal(shouldSkipDebouncedAuthRefresh({}), false);
    assert.equal(shouldSkipDebouncedAuthRefresh({ hidden: undefined }), false);
  });

  it('无 document 环境（注入 null）→ 不跳过（保守刷新，不静默丢登录态）', () => {
    assert.equal(shouldSkipDebouncedAuthRefresh(null), false);
    assert.equal(shouldSkipDebouncedAuthRefresh(undefined), false);
  });

  it('content.js 加载链中 lib 注册为全局 AuthRefreshDebounce（manifest 注入契约）', () => {
    // content.js 在页面上下文直接调用 shouldSkipDebouncedAuthRefresh ——
    // lib 经 UMD 双注册（module.exports + globalThis），两种加载路径都可取用
    const vm = require('node:vm');
    const fs = require('node:fs');
    const path = require('node:path');
    const sandbox = { globalThis: null };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(__dirname, '../lib/auth-refresh-debounce.js'), 'utf8');
    vm.runInContext(src, sandbox);
    assert.equal(sandbox.AuthRefreshDebounce.shouldSkipDebouncedAuthRefresh({ hidden: true }), true);
    assert.equal(sandbox.AuthRefreshDebounce.shouldSkipDebouncedAuthRefresh({ hidden: false }), false);
  });
});

describe('resolveAuthBadgeTickFollowUp（角标 tick 与工作空间补加载）', () => {
  it('隐藏页跳过的补跑 → full（避免角标已登录、下拉仍请先登录）', () => {
    assert.equal(
      resolveAuthBadgeTickFollowUp({
        pendingHiddenRefresh: true,
        loggedIn: false,
        selectNeedsLoad: false,
      }),
      'full',
    );
  });

  it('已登录且下拉仍是未登录占位 → loadWorkspaces', () => {
    assert.equal(
      resolveAuthBadgeTickFollowUp({
        pendingHiddenRefresh: false,
        loggedIn: true,
        selectNeedsLoad: true,
      }),
      'loadWorkspaces',
    );
  });

  it('已登录且工作空间已在下拉中 → none（不得冲掉已加载列表）', () => {
    assert.equal(
      resolveAuthBadgeTickFollowUp({
        pendingHiddenRefresh: false,
        loggedIn: true,
        selectNeedsLoad: false,
      }),
      'none',
    );
  });

  it('未登录 → none（占位由 checkLoginStatus 处理）', () => {
    assert.equal(
      resolveAuthBadgeTickFollowUp({
        pendingHiddenRefresh: false,
        loggedIn: false,
        selectNeedsLoad: true,
      }),
      'none',
    );
  });
});
