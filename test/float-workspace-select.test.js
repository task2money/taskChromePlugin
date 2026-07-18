'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveFloatWorkspaceSelectAction,
  floatWorkspaceSelectPlaceholder,
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
