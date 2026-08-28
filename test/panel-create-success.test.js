'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PanelCreateSuccess = require('../lib/panel-create-success.js');

function field(value) {
  return { value, checked: false, hidden: false, innerHTML: 'kept', disabled: false };
}

function fakeRoot(overrides = {}) {
  const fields = {
    singleTaskTitle: field('旧标题'),
    singleTaskDesc: field('旧描述'),
    singleWorkBranch: field('feat/x'),
    singleMergeTarget: field('main'),
    singleDeliverable: field('d1'),
    singleContainerImage: field('img1'),
    singleFeatureParamsSource: field('company'),
    singlePersonalConfig: field('p1'),
    singlePersonalConfigWrap: { hidden: false },
    singleDueDate: field('2026-01-01T00:00'),
    singlePriority: field('0'),
    singleAutoRun: { checked: true, disabled: false },
    singleQueuedAutoRun: { checked: true },
    singleQueuedAutoRunWrap: { hidden: false },
    singleQueuedAutoRunError: { hidden: false, textContent: 'err', className: 'result error' },
    singleRepoBases: { innerHTML: '<input>' },
    singleGitIdentities: { innerHTML: '<select>' },
    singleWorkspace: field('ws-keep'),
    singleOwner: field('owner-keep'),
    singleProgressColumn: field('col-keep'),
    singleResult: { textContent: '旧结果', className: 'result' },
    ...overrides,
  };
  const radios = overrides._radios || [{ checked: true, className: 'project-radio' }];
  const assignees = overrides._assignees || [{ checked: true, className: 'assignee-check' }];
  return {
    fields,
    radios,
    assignees,
    getElementById(id) {
      return fields[id] || null;
    },
    querySelectorAll(sel) {
      if (sel.includes('project-radio')) return radios;
      if (sel.includes('assignee-check')) return assignees;
      return [];
    },
  };
}

describe('PanelCreateSuccess order', () => {
  it('formats created task id for the success banner', () => {
    assert.equal(PanelCreateSuccess.extractCreatedTaskId({ id: 't1' }), 't1');
    assert.equal(PanelCreateSuccess.extractCreatedTaskId({ _id: 't2' }), 't2');
    assert.equal(PanelCreateSuccess.extractCreatedTaskId(null), '(已创建)');
    assert.equal(
      PanelCreateSuccess.formatCreateSuccessMessage('t1'),
      '✅ 任务创建成功! ID: t1',
    );
    assert.equal(
      PanelCreateSuccess.formatCreateFailureMessage('网络超时'),
      '❌ 创建失败: 网络超时',
    );
  });

  it('runAfterSuccess resets form before showing the success message', () => {
    const order = [];
    PanelCreateSuccess.runAfterSuccess({
      reset: () => order.push('reset'),
      showSuccess: (msg) => order.push(`success:${msg}`),
      message: '✅ 任务创建成功! ID: t1',
    });
    assert.deepEqual(order, ['reset', 'success:✅ 任务创建成功! ID: t1']);
  });

  it('runAfterSuccess throws when reset or showSuccess is missing', () => {
    assert.throws(() => PanelCreateSuccess.runAfterSuccess({
      showSuccess: () => {},
      message: 'x',
    }), /reset/);
    assert.throws(() => PanelCreateSuccess.runAfterSuccess({
      reset: () => {},
      message: 'x',
    }), /showSuccess/);
  });

  it('runAfterFailure only shows the error and never resets', () => {
    const order = [];
    PanelCreateSuccess.runAfterFailure({
      showError: (msg, traceId) => order.push(`error:${msg}:${traceId || ''}`),
      message: '❌ 创建失败: boom',
      traceId: 'tid-1',
    });
    assert.deepEqual(order, ['error:❌ 创建失败: boom:tid-1']);
  });

  it('runAfterFailure throws when showError is missing or reset is passed', () => {
    assert.throws(() => PanelCreateSuccess.runAfterFailure({
      message: 'x',
    }), /showError/);
    assert.throws(() => PanelCreateSuccess.runAfterFailure({
      reset: () => {},
      showError: () => {},
      message: 'x',
    }), /must not reset/);
  });
});

describe('PanelCreateSuccess.resetSingleCreateFields', () => {
  it('clears user options but keeps workspace/owner/progress and result slot', () => {
    const root = fakeRoot();
    PanelCreateSuccess.resetSingleCreateFields(root, {
      emptyHint: '空则用项目默认分支',
      defaultDueDate: '2026-09-03T18:00',
      defaultPriority: '1',
    });
    assert.equal(root.fields.singleTaskTitle.value, '');
    assert.equal(root.fields.singleTaskDesc.value, '');
    assert.equal(root.fields.singleWorkBranch.value, '');
    assert.equal(root.fields.singleMergeTarget.value, '');
    assert.equal(root.fields.singleDeliverable.value, '');
    assert.equal(root.fields.singleContainerImage.value, '');
    assert.equal(root.fields.singleFeatureParamsSource.value, '');
    assert.equal(root.fields.singlePersonalConfig.value, '');
    assert.equal(root.fields.singlePersonalConfigWrap.hidden, true);
    assert.equal(root.fields.singleDueDate.value, '2026-09-03T18:00');
    assert.equal(root.fields.singlePriority.value, '1');
    assert.equal(root.fields.singleAutoRun.checked, false);
    assert.equal(root.fields.singleQueuedAutoRun.checked, false);
    assert.equal(root.fields.singleQueuedAutoRunWrap.hidden, true);
    assert.match(root.fields.singleRepoBases.innerHTML, /空则用项目默认分支/);
    assert.equal(root.fields.singleGitIdentities.innerHTML, '');
    assert.equal(root.radios[0].checked, false);
    assert.equal(root.assignees[0].checked, false);
    assert.equal(root.fields.singleWorkspace.value, 'ws-keep');
    assert.equal(root.fields.singleOwner.value, 'owner-keep');
    assert.equal(root.fields.singleProgressColumn.value, 'col-keep');
    assert.equal(root.fields.singleResult.textContent, '旧结果');
  });
});

describe('PanelCreateSuccess.resetBatchCreateFields', () => {
  function batchField(value) {
    return { value, checked: false, hidden: false, innerHTML: 'kept', disabled: false };
  }

  function fakeBatchRoot(overrides = {}) {
    const fields = {
      batchWorkBranch: batchField('feat/x'),
      batchMergeTarget: batchField('main'),
      batchDeliverable: batchField('d1'),
      batchContainerImage: batchField('img1'),
      batchFeatureParamsSource: batchField('company'),
      batchPersonalConfig: batchField('p1'),
      batchPersonalConfigWrap: { hidden: false },
      batchDueDate: batchField('2026-01-01T00:00'),
      batchAutoRun: { checked: true },
      batchQueuedAutoRun: { checked: true },
      batchQueuedAutoRunWrap: { hidden: false },
      batchQueuedAutoRunError: { hidden: false, textContent: 'err', className: 'result error' },
      batchRepoBases: { innerHTML: '<input>' },
      batchGitIdentities: { innerHTML: '<select>' },
      batchWorkspace: batchField('ws-keep'),
      batchProgressColumn: batchField('col-keep'),
      batchResult: { textContent: '旧结果', className: 'result' },
      ...overrides,
    };
    const radios = overrides._radios || [{ checked: true, className: 'project-radio' }];
    return {
      fields,
      radios,
      getElementById(id) {
        return fields[id] || null;
      },
      querySelectorAll(sel) {
        if (sel.includes('project-radio')) return radios;
        return [];
      },
    };
  }

  it('clears batch options but keeps workspace/progress and result slot', () => {
    const root = fakeBatchRoot();
    PanelCreateSuccess.resetBatchCreateFields(root, {
      emptyHint: '空则用项目默认分支',
      defaultDueDate: '2026-09-03T18:00',
    });
    assert.equal(root.fields.batchWorkBranch.value, '');
    assert.equal(root.fields.batchMergeTarget.value, '');
    assert.equal(root.fields.batchDeliverable.value, '');
    assert.equal(root.fields.batchContainerImage.value, '');
    assert.equal(root.fields.batchFeatureParamsSource.value, '');
    assert.equal(root.fields.batchPersonalConfig.value, '');
    assert.equal(root.fields.batchPersonalConfigWrap.hidden, true);
    assert.equal(root.fields.batchDueDate.value, '2026-09-03T18:00');
    assert.equal(root.fields.batchAutoRun.checked, false);
    assert.equal(root.fields.batchQueuedAutoRun.checked, false);
    assert.equal(root.fields.batchQueuedAutoRunWrap.hidden, true);
    assert.equal(root.fields.batchQueuedAutoRunError.hidden, true);
    assert.equal(root.fields.batchQueuedAutoRunError.textContent, '');
    assert.match(root.fields.batchRepoBases.innerHTML, /空则用项目默认分支/);
    assert.equal(root.fields.batchGitIdentities.innerHTML, '');
    assert.equal(root.radios[0].checked, false);
    assert.equal(root.fields.batchWorkspace.value, 'ws-keep');
    assert.equal(root.fields.batchProgressColumn.value, 'col-keep');
    assert.equal(root.fields.batchResult.textContent, '旧结果');
  });

  it('throws when required opts are missing', () => {
    assert.throws(() => PanelCreateSuccess.resetBatchCreateFields({}, {}), /emptyHint/);
  });
});

describe('DevTools createBatchTasks wires reset-then-success', () => {
  it('batch.js clears batch form before showing success', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'panel/tabs/batch.js'), 'utf8');
    const fn = src.slice(src.indexOf('P.createBatchTasks = async function'));
    const runAt = fn.indexOf('runAfterSuccess');
    const resetAt = fn.indexOf('resetBatchCreateForm');
    assert.ok(runAt >= 0, 'createBatchTasks must call runAfterSuccess');
    assert.ok(resetAt > runAt, 'reset must be passed into runAfterSuccess');
    assert.match(fn, /reset:\s*\(\)\s*=>\s*P\.resetBatchCreateForm\(\)/);
    assert.match(fn, /showSuccess:\s*\(msg\)\s*=>\s*P\.showR\('batchResult', 'success'/);
    assert.doesNotMatch(
      fn.slice(0, runAt),
      /showR\('batchResult', 'success'/,
      'must not show success before runAfterSuccess',
    );
  });

  it('batch.js failure path only prompts and does not reset the form', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'panel/tabs/batch.js'), 'utf8');
    const fn = src.slice(src.indexOf('P.createBatchTasks = async function'));
    const tryAt = fn.indexOf('try {');
    const catchAt = fn.indexOf('} catch');
    const finallyAt = fn.indexOf('} finally');
    assert.ok(tryAt >= 0 && catchAt > tryAt && finallyAt > catchAt);
    const catchFn = fn.slice(catchAt, finallyAt);
    assert.match(catchFn, /showR\('batchResult', 'error'/);
    assert.doesNotMatch(catchFn, /resetBatchCreateForm/);
    assert.doesNotMatch(catchFn, /runAfterSuccess/);
  });

  it('panel.html loads panel-create-success.js before batch.js', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'panel/panel.html'), 'utf8');
    const success = html.indexOf('panel-create-success.js');
    const tab = html.indexOf('tabs/batch.js');
    assert.ok(success >= 0 && success < tab);
  });
});

describe('DevTools createSingleTask wires reset-then-success', () => {
  it('single-request.js resets before showing success', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'panel/tabs/single-request.js'), 'utf8');
    const fn = src.slice(src.indexOf('P.createSingleTask = async function'));
    const runAt = fn.indexOf('runAfterSuccess');
    const resetAt = fn.indexOf('resetSingleCreateForm');
    assert.ok(runAt >= 0, 'createSingleTask must call runAfterSuccess');
    assert.ok(resetAt > runAt, 'reset must be passed into runAfterSuccess');
    assert.match(fn, /reset:\s*\(\)\s*=>\s*P\.resetSingleCreateForm\(\)/);
    assert.match(fn, /showSuccess:\s*\(msg\)\s*=>\s*P\.showR\('singleResult', 'success'/);
    assert.doesNotMatch(
      fn.slice(0, runAt),
      /showR\('singleResult', 'success'/,
      'must not show success before runAfterSuccess',
    );
  });

  it('single-request.js failure path only prompts and does not reset', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'panel/tabs/single-request.js'), 'utf8');
    const fn = src.slice(src.indexOf('P.createSingleTask = async function'));
    const tryAt = fn.indexOf('try {');
    const catchAt = fn.indexOf('} catch');
    const finallyAt = fn.indexOf('} finally');
    assert.ok(tryAt >= 0 && catchAt > tryAt && finallyAt > catchAt);
    assert.doesNotMatch(
      fn.slice(0, tryAt),
      /resetSingleCreateForm/,
      'validation errors must not reset the form',
    );
    const catchFn = fn.slice(catchAt, finallyAt);
    assert.match(catchFn, /runAfterFailure/);
    assert.doesNotMatch(catchFn, /resetSingleCreateForm/);
    assert.doesNotMatch(catchFn, /runAfterSuccess/);
    assert.doesNotMatch(fn.slice(finallyAt), /resetSingleCreateForm/);
    assert.match(catchFn, /showR\('singleResult', 'error'/);
  });

  it('panel.html loads panel-create-success.js before single-request.js', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'panel/panel.html'), 'utf8');
    const success = html.indexOf('panel-create-success.js');
    const tab = html.indexOf('tabs/single-request.js');
    assert.ok(success >= 0 && success < tab);
  });
});
