'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const WM = require('../lib/workspace-members.js');

describe('WorkspaceMembers', () => {
  it('memberUserId 优先 user（collaborators），再 user_id / userId', () => {
    assert.equal(WM.memberUserId({ user: 'u1', user_id: 'u2' }), 'u1');
    assert.equal(WM.memberUserId({ user_id: 'u2' }), 'u2');
    assert.equal(WM.memberUserId({ userId: 'u3' }), 'u3');
    assert.equal(WM.memberUserId(null), '');
  });

  it('preferDefaultOwnerId：memberId 命中优先', () => {
    const members = [
      { id: 'm1', user: 'u1' },
      { id: 'm2', user: 'u2' },
    ];
    assert.equal(WM.preferDefaultOwnerId(members, {
      currentMemberId: 'm2',
      currentUserId: 'u1',
    }), 'm2');
  });

  it('preferDefaultOwnerId：按 user 字段匹配当前用户', () => {
    const members = [
      { id: 'm1', user: 'u1' },
      { id: 'm9', user: 'me' },
    ];
    assert.equal(WM.preferDefaultOwnerId(members, { currentUserId: 'me' }), 'm9');
  });

  it('preferDefaultOwnerId：仅一名成员时回退该 id', () => {
    assert.equal(WM.preferDefaultOwnerId([{ id: 'only', user: 'x' }], {}), 'only');
  });

  it('preferDefaultOwnerId：无匹配返回空', () => {
    assert.equal(WM.preferDefaultOwnerId(
      [{ id: 'm1', user: 'a' }, { id: 'm2', user: 'b' }],
      { currentUserId: 'z' },
    ), '');
  });

  it('unwrapMembersResponse 兼容数组与嵌套', () => {
    assert.deepEqual(WM.unwrapMembersResponse([{ id: 1 }]), [{ id: 1 }]);
    assert.deepEqual(WM.unwrapMembersResponse({ members: [{ id: 2 }] }), [{ id: 2 }]);
    assert.deepEqual(WM.unwrapMembersResponse(null), []);
  });
});
