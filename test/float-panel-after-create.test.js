'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeOpenSnapshot,
  formatFloatCreateSuccessToast,
  extractCreatedTaskId,
} = require('../lib/float-panel-after-create.js');

describe('normalizeOpenSnapshot', () => {
  it('空输入得到稳定默认快照', () => {
    const snap = normalizeOpenSnapshot(null);
    assert.equal(snap.workspaceId, '');
    assert.deepEqual(snap.projectIds, []);
    assert.equal(snap.priority, '1');
    assert.equal(snap.auto_run, false);
    assert.deepEqual(snap.repoBaseBranches, {});
  });

  it('保留工作空间/项目与用户字段', () => {
    const snap = normalizeOpenSnapshot({
      workspaceId: 12,
      projectIds: [1, '2'],
      title: 't',
      description: 'd',
      priority: '0',
      auto_run: true,
      repoBaseBranches: { a: 'main' },
      assigneeIds: [9],
      workBranch: 'feature/x',
      mergeTarget: 'develop',
    });
    assert.equal(snap.workspaceId, '12');
    assert.deepEqual(snap.projectIds, ['1', '2']);
    assert.equal(snap.title, 't');
    assert.equal(snap.auto_run, true);
    assert.deepEqual(snap.repoBaseBranches, { a: 'main' });
    assert.deepEqual(snap.assigneeIds, ['9']);
  });
});

describe('formatFloatCreateSuccessToast / extractCreatedTaskId', () => {
  it('优先 id，其次 _id', () => {
    assert.equal(extractCreatedTaskId({ id: 'abc' }), 'abc');
    assert.equal(extractCreatedTaskId({ _id: 'xyz' }), 'xyz');
    assert.equal(extractCreatedTaskId({}), '(已创建)');
  });

  it('toast 文案含任务 ID', () => {
    assert.equal(
      formatFloatCreateSuccessToast(extractCreatedTaskId({ id: 42 })),
      '✅ 任务创建成功! ID: 42',
    );
  });
});
