'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const FloatMembersUi = require('../lib/float-members-ui.js');
const WorkspaceMembers = require('../lib/workspace-members.js');

describe('FloatMembersUi', () => {
  it('buildOwnerSelectHtml 默认当前用户', () => {
    const { html, preferred } = FloatMembersUi.buildOwnerSelectHtml(
      [{ id: 'm1', user: 'a' }, { id: 'm2', user: 'me', member_name: 'Me' }],
      { currentUserId: 'me', WorkspaceMembers },
    );
    assert.equal(preferred, 'm2');
    assert.match(html, /value="m2"/);
    assert.match(html, />Me</);
  });

  it('buildAssigneesCheckboxHtml 空列表提示', () => {
    assert.match(FloatMembersUi.buildAssigneesCheckboxHtml([]), /暂无成员/);
  });
});
