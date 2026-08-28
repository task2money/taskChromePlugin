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

  it('panel.html loads panel-create-success.js before single-request.js', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'panel/panel.html'), 'utf8');
    const success = html.indexOf('panel-create-success.js');
    const tab = html.indexOf('tabs/single-request.js');
    assert.ok(success >= 0 && success < tab);
  });
});
