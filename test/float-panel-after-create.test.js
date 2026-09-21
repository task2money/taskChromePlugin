'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// 模块用全局 tx() 取词（content_scripts 主组先加载 lib/i18n-tx.js）；
// Node 单测须先安装同构取词运行时，默认 zh-CN，断言沿用迁移前文案。
require('./helpers/txRuntime.js').installTxRuntime();

const {
  normalizeOpenSnapshot,
  formatFloatCreateSuccessToast,
  extractCreatedTaskId,
  companyIdOfWorkspace,
  buildTaskDetailHref,
  buildFloatCreateSuccessToastParts,
  buildFloatCreateSuccessToastView,
  FLOAT_CREATE_SUCCESS_TOAST_MS,
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
      ownerId: 'm7',
      assigneeIds: [9],
      workBranch: 'feature/x',
      mergeTarget: 'develop',
    });
    assert.equal(snap.workspaceId, '12');
    assert.deepEqual(snap.projectIds, ['1', '2']);
    assert.equal(snap.title, 't');
    assert.equal(snap.auto_run, true);
    assert.deepEqual(snap.repoBaseBranches, { a: 'main' });
    assert.equal(snap.ownerId, 'm7');
    assert.deepEqual(snap.assigneeIds, ['9']);
  });

  it('owner 别名写入 ownerId', () => {
    assert.equal(normalizeOpenSnapshot({ owner: 'ox' }).ownerId, 'ox');
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

describe('buildTaskDetailHref / toast parts', () => {
  it('成功 toast 默认 5 秒后消失', () => {
    assert.equal(FLOAT_CREATE_SUCCESS_TOAST_MS, 5000);
  });

  it('从工作空间列表解析 companyId', () => {
    assert.equal(
      companyIdOfWorkspace(
        [{ id: 'ws1', company_id: 'co1' }, { _id: 'ws2', companyId: 'co2' }],
        'ws2',
      ),
      'co2',
    );
    assert.equal(companyIdOfWorkspace([], 'ws1'), '');
  });

  it('拼出任务详情 SPA 路径', () => {
    assert.equal(
      buildTaskDetailHref({
        baseUrl: 'https://aidevpush.com/',
        companyId: '881024523581812736',
        workspaceId: 'ws_881024527847419904',
        taskId: 'task_42',
      }),
      'https://aidevpush.com/tenant/881024523581812736/workspace/ws_881024527847419904/task-detail/task_42/',
    );
  });

  it('缺租户/工作空间或占位 ID 时不生成链接', () => {
    assert.equal(
      buildTaskDetailHref({
        baseUrl: 'https://aidevpush.com',
        companyId: '',
        workspaceId: 'ws1',
        taskId: 't1',
      }),
      '',
    );
    assert.equal(
      buildTaskDetailHref({
        baseUrl: 'https://aidevpush.com',
        companyId: 'c1',
        workspaceId: 'ws1',
        taskId: '(已创建)',
      }),
      '',
    );
    assert.equal(
      buildTaskDetailHref({
        baseUrl: 'javascript:alert(1)',
        companyId: 'c1',
        workspaceId: 'ws1',
        taskId: 't1',
      }),
      '',
    );
  });

  it('有 href 时把任务 ID 拆成可点链接段', () => {
    const href = buildTaskDetailHref({
      baseUrl: 'https://www.aidevpush.com',
      companyId: 'c1',
      workspaceId: 'ws1',
      taskId: 'task_9',
    });
    const parts = buildFloatCreateSuccessToastParts('task_9', href);
    assert.equal(parts.kind, 'link');
    assert.equal(parts.linkText, 'task_9');
    assert.equal(parts.href, href);
    assert.match(parts.before, /任务创建成功/);
    assert.equal(parts.after, '');
  });

  it('无 href 时退回纯文本', () => {
    const parts = buildFloatCreateSuccessToastParts('task_9', '');
    assert.equal(parts.kind, 'text');
    assert.equal(parts.text, '✅ 任务创建成功! ID: task_9');
  });

  it('view 一次组装文案、链接与 5s', () => {
    const view = buildFloatCreateSuccessToastView({
      data: { id: 'task_9' },
      baseUrl: 'https://aidevpush.com',
      workspaces: [{ id: 'ws1', company_id: 'c1' }],
      workspaceId: 'ws1',
    });
    assert.equal(view.durationMs, 5000);
    assert.equal(view.parts.kind, 'link');
    assert.equal(view.parts.linkText, 'task_9');
    assert.equal(
      view.parts.href,
      'https://aidevpush.com/tenant/c1/workspace/ws1/task-detail/task_9/',
    );
  });

  it('浮窗接线把详情 href 与 5s 传给 toast', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const form = fs.readFileSync(path.join(__dirname, '../content/float-form.js'), 'utf8');
    const toast = fs.readFileSync(path.join(__dirname, '../content/content.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../content/content-form.css'), 'utf8');
    assert.match(form, /buildFloatCreateSuccessToastView/);
    assert.match(form, /showPageToast\(toastView\.text,\s*\{\s*parts:\s*toastView\.parts,\s*durationMs:\s*toastView\.durationMs\s*\}\)/);
    assert.match(toast, /parts\.kind === 'link'/);
    assert.match(toast, /target = '_blank'/);
    assert.match(css, /pointer-events:\s*auto/);
    assert.match(css, /taskplugin-page-toast-link/);
  });
});
