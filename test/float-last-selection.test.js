'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

globalThis.PageAdvisorDefaults = require('../lib/page-advisor-defaults.js');
const {
  matchLastWorkspaceId,
  applyLastWorkspaceToSelect,
  applyLastProjectToRadios,
} = require('../lib/float-last-selection.js');

function fakeSelect(initial) {
  return { value: initial == null ? '' : String(initial) };
}

function fakeRadios(values, checkedIndex) {
  const radios = values.map((v, i) => ({
    value: v,
    checked: i === checkedIndex,
  }));
  return {
    querySelectorAll(sel) {
      assert.equal(sel, 'input.project-radio');
      return radios;
    },
  };
}

describe('float-last-selection', () => {
  it('matchLastWorkspaceId returns id when present', () => {
    assert.equal(matchLastWorkspaceId([{ id: 'a' }, { _id: 'b' }], 'b'), 'b');
    assert.equal(matchLastWorkspaceId([{ id: 'a' }], 'z'), '');
  });

  it('applyLastWorkspaceToSelect skips when already selected', () => {
    const sel = fakeSelect('x');
    assert.equal(applyLastWorkspaceToSelect(sel, [{ id: 'a' }], 'a'), '');
    assert.equal(sel.value, 'x');
  });

  it('applyLastWorkspaceToSelect applies last id', () => {
    const sel = fakeSelect('');
    assert.equal(applyLastWorkspaceToSelect(sel, [{ id: 'a' }], 'a'), 'a');
    assert.equal(sel.value, 'a');
  });

  it('applyLastProjectToRadios selects preferred project', () => {
    const root = fakeRadios(['p1', 'p2'], -1);
    const pick = applyLastProjectToRadios(
      root,
      [{ id: 'p1' }, { id: 'p2' }],
      ['p2'],
    );
    assert.equal(pick, 'p2');
    assert.equal(root.querySelectorAll('input.project-radio')[1].checked, true);
  });

  it('applyLastProjectToRadios skips when one already checked', () => {
    const root = fakeRadios(['p1', 'p2'], 0);
    assert.equal(
      applyLastProjectToRadios(root, [{ id: 'p1' }, { id: 'p2' }], ['p2']),
      '',
    );
  });
});
