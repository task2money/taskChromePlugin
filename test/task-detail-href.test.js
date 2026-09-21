'use strict';

/**
 * OPT-20260921-028: 任务详情链接构造抽到 lib/task-detail-href.js，
 * 浮窗 toast 与 DevTools 面板成功提示共用同一 URL 契约。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./helpers/txRuntime.js').installTxRuntime();

const ROOT = path.resolve(__dirname, '..');
const Href = require('../lib/task-detail-href.js');

describe('TaskDetailHref.buildTaskDetailHref', () => {
  it('拼出 /tenant/{cid}/workspace/{wid}/task-detail/{tid}/', () => {
    assert.equal(
      Href.buildTaskDetailHref({
        baseUrl: 'https://www.aidevpush.com/api/',
        companyId: 'c1',
        workspaceId: 'w2',
        taskId: '100',
      }),
      'https://www.aidevpush.com/tenant/c1/workspace/w2/task-detail/100/',
    );
  });

  it('缺 companyId / workspaceId / 非 http(s) baseUrl 时返回空串', () => {
    assert.equal(Href.buildTaskDetailHref({ baseUrl: 'https://x.com', workspaceId: 'w', taskId: 't' }), '');
    assert.equal(Href.buildTaskDetailHref({ baseUrl: 'https://x.com', companyId: 'c', taskId: 't' }), '');
    assert.equal(
      Href.buildTaskDetailHref({ baseUrl: 'ftp://x.com', companyId: 'c', workspaceId: 'w', taskId: 't' }),
      '',
    );
  });

  it('任务 ID 含路径分隔符时不产出链接', () => {
    assert.equal(Href.isLinkableCreatedTaskId('a/b'), false);
    assert.equal(Href.isLinkableCreatedTaskId('t1'), true);
    assert.equal(Href.isLinkableCreatedTaskId(''), false);
  });
});

describe('TaskDetailHref.buildLinkParts', () => {
  it('命中 ID 时切成 before/linkText/after', () => {
    const parts = Href.buildLinkParts('✅ 任务创建成功! ID: t1', 't1', 'https://x.com/tenant/c/w/task-detail/t1/');
    assert.equal(parts.kind, 'link');
    assert.equal(parts.linkText, 't1');
    assert.equal(parts.before, '✅ 任务创建成功! ID: ');
    assert.equal(parts.after, '');
  });

  it('文案含多个 ID 片段时取最后一处（与浮窗既有行为一致）', () => {
    const parts = Href.buildLinkParts('ID: t1 / 再次 ID: t1', 't1', 'https://x.com/a');
    assert.equal(parts.before, 'ID: t1 / 再次 ID: ');
    assert.equal(parts.after, '');
  });

  it('无 href / 文案不含 ID / 非 http(s) href 时退回纯文本', () => {
    assert.deepEqual(
      Href.buildLinkParts('✅ 任务创建成功! ID: t1', 't1', ''),
      { kind: 'text', text: '✅ 任务创建成功! ID: t1' },
    );
    assert.deepEqual(
      Href.buildLinkParts('✅ 任务创建成功! ID: t1', 't1', 'javascript:alert(1)'),
      { kind: 'text', text: '✅ 任务创建成功! ID: t1' },
    );
    assert.deepEqual(
      Href.buildLinkParts('无关文案', 't1', 'https://x.com/a'),
      { kind: 'text', text: '无关文案' },
    );
  });
});

describe('content_scripts 契约', () => {
  it('manifest 在 float-panel-after-create 之前加载 task-detail-href', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const libs = manifest.content_scripts[0].js;
    assert.ok(
      libs.indexOf('lib/task-detail-href.js') > -1,
      'manifest 未列出 lib/task-detail-href.js',
    );
    assert.ok(
      libs.indexOf('lib/task-detail-href.js') < libs.indexOf('lib/float-panel-after-create.js'),
      'task-detail-href 必须先于 float-panel-after-create 加载',
    );
  });

  it('浮窗模块转发到共享实现（同一份 URL 契约）', () => {
    const Float = require('../lib/float-panel-after-create.js');
    const opts = { baseUrl: 'https://x.com', companyId: 'c', workspaceId: 'w', taskId: 't' };
    assert.equal(Float.buildTaskDetailHref(opts), Href.buildTaskDetailHref(opts));
    assert.equal(
      Float.companyIdOfWorkspace([{ id: 'w', company_id: 'c' }], 'w'),
      Href.companyIdOfWorkspace([{ id: 'w', company_id: 'c' }], 'w'),
    );
  });
});
