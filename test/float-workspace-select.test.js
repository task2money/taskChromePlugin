'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveFloatWorkspaceSelectAction,
  floatWorkspaceSelectPlaceholder,
  isUnauthedWorkspacePlaceholder,
  selectNeedsWorkspaceLoad,
} = require('../lib/float-workspace-select.js');

describe('resolveFloatWorkspaceSelectAction', () => {
  it('full mode + logged in → loading（供随后 loadWorkspaces）', () => {
    assert.equal(
      resolveFloatWorkspaceSelectAction({ loggedIn: true, mode: 'full' }),
      'loading',
    );
  });

  it('badgeOnly + logged in → leave（不得冲掉已加载工作空间）', () => {
    assert.equal(
      resolveFloatWorkspaceSelectAction({ loggedIn: true, mode: 'badgeOnly' }),
      'leave',
    );
  });

  it('badgeOnly + logged in + 下拉仍是未登录占位 → loading（须补加载，禁止角标已登录/下拉请先登录）', () => {
    assert.equal(
      resolveFloatWorkspaceSelectAction({
        loggedIn: true,
        mode: 'badgeOnly',
        selectNeedsWorkspaceLoad: true,
      }),
      'loading',
    );
  });

  it('未登录时无论 mode 都清空为请先登录', () => {
    assert.equal(
      resolveFloatWorkspaceSelectAction({ loggedIn: false, mode: 'full' }),
      'login_required',
    );
    assert.equal(
      resolveFloatWorkspaceSelectAction({ loggedIn: false, mode: 'badgeOnly' }),
      'login_required',
    );
  });

  it('扩展上下文失效 → refresh_page', () => {
    assert.equal(
      resolveFloatWorkspaceSelectAction({
        loggedIn: false,
        mode: 'badgeOnly',
        invalidated: true,
      }),
      'refresh_page',
    );
  });
});

describe('floatWorkspaceSelectPlaceholder', () => {
  it('maps actions to option labels; leave → null', () => {
    assert.equal(floatWorkspaceSelectPlaceholder('loading'), '加载中...');
    assert.equal(floatWorkspaceSelectPlaceholder('login_required'), '-- 请先登录 --');
    assert.equal(floatWorkspaceSelectPlaceholder('refresh_page'), '-- 请刷新页面后重试 --');
    assert.equal(floatWorkspaceSelectPlaceholder('leave'), null);
  });
});

describe('isUnauthedWorkspacePlaceholder', () => {
  it('recognizes login/expiry/refresh placeholders and rejects real labels', () => {
    assert.equal(isUnauthedWorkspacePlaceholder('-- 请先登录 --'), true);
    assert.equal(isUnauthedWorkspacePlaceholder('请先登录'), true);
    assert.equal(isUnauthedWorkspacePlaceholder('-- 会话过期，请重新登录 --'), true);
    assert.equal(isUnauthedWorkspacePlaceholder('-- 请刷新页面后重试 --'), true);
    assert.equal(isUnauthedWorkspacePlaceholder('-- 请在扩展中重新登录 --'), true);
    assert.equal(isUnauthedWorkspacePlaceholder('加载失败: timeout'), true);
    assert.equal(isUnauthedWorkspacePlaceholder('-- 选择工作空间 --'), false);
    assert.equal(isUnauthedWorkspacePlaceholder('(无工作空间)'), false);
    assert.equal(isUnauthedWorkspacePlaceholder('加载中...'), false);
    assert.equal(isUnauthedWorkspacePlaceholder('Acme / 主空间'), false);
  });
});

describe('selectNeedsWorkspaceLoad', () => {
  function fakeSelect(firstText, extraCount = 0) {
    const options = [{ textContent: firstText }];
    for (let i = 0; i < extraCount; i++) options.push({ textContent: `ws-${i}` });
    return { options };
  }

  it('true when empty, missing select, or first option is unauthed placeholder', () => {
    assert.equal(selectNeedsWorkspaceLoad(null, { workspacesCount: 0 }), true);
    assert.equal(selectNeedsWorkspaceLoad({ options: [] }, { workspacesCount: 0 }), true);
    assert.equal(
      selectNeedsWorkspaceLoad(fakeSelect('-- 请先登录 --'), { workspacesCount: 0 }),
      true,
    );
  });

  it('false when workspaces already loaded or first option is a real/empty/loading state', () => {
    assert.equal(
      selectNeedsWorkspaceLoad(fakeSelect('-- 请先登录 --'), { workspacesCount: 3 }),
      false,
    );
    assert.equal(
      selectNeedsWorkspaceLoad(fakeSelect('-- 选择工作空间 --', 2), { workspacesCount: 0 }),
      false,
    );
    assert.equal(
      selectNeedsWorkspaceLoad(fakeSelect('加载中...'), { workspacesCount: 0 }),
      false,
    );
    assert.equal(
      selectNeedsWorkspaceLoad(fakeSelect('(无工作空间)'), { workspacesCount: 0 }),
      false,
    );
  });
});
