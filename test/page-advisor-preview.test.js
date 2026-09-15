'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const PageAdvisorPreview = require('../lib/page-advisor-preview.js');

function makeButton(text, nid = 'n1') {
  const attrs = {};
  if (nid) attrs['data-taskplugin-nid'] = nid;
  const style = {};
  const classList = new Set();
  return {
    nodeType: 1,
    tagName: 'BUTTON',
    isConnected: true,
    textContent: text,
    style,
    classList: {
      add: (c) => classList.add(c),
      remove: (c) => classList.delete(c),
      contains: (c) => classList.has(c),
    },
    getAttribute: (n) => (attrs[n] != null ? attrs[n] : null),
    setAttribute: (n, v) => { attrs[n] = String(v); },
    removeAttribute: (n) => { delete attrs[n]; },
    hasAttribute: (n) => Object.prototype.hasOwnProperty.call(attrs, n),
  };
}

function makePassword() {
  const attrs = { 'data-taskplugin-nid': 'n2', type: 'password' };
  return {
    nodeType: 1,
    tagName: 'INPUT',
    type: 'password',
    style: {},
    getAttribute: (n) => (attrs[n] != null ? attrs[n] : null),
    setAttribute: (n, v) => { attrs[n] = String(v); },
    removeAttribute: (n) => { delete attrs[n]; },
    hasAttribute: (n) => Object.prototype.hasOwnProperty.call(attrs, n),
  };
}

describe('page-advisor-preview sanitize', () => {
  it('drops illegal ops and keeps whitelist', () => {
    const ops = PageAdvisorPreview.sanitizePreviewOps([
      { op: 'setText', nid: 'n1', value: 'A' },
      { op: 'eval', nid: 'n1' },
      { op: 'addClass', nid: 'n2', value: 'x' },
      { op: 'addClass', nid: 'n2', value: 'taskplugin-preview-x' },
    ]);
    assert.equal(ops.length, 2);
    assert.equal(ops[1].value, 'taskplugin-preview-x');
  });
});

describe('page-advisor-preview apply/undo', () => {
  it('applies setText and undoes', () => {
    const btn = makeButton('提交');
    const map = { n1: btn };
    const session = PageAdvisorPreview.createPreviewSession({
      resolveNid: (nid) => map[nid] || null,
    });
    const sug = {
      id: 's1',
      preview: { ops: [{ op: 'setText', nid: 'n1', value: '立即提交' }] },
    };
    assert.equal(session.applySuggestion(sug).applied, true);
    assert.equal(btn.textContent, '立即提交');
    session.undoOne('s1');
    assert.equal(btn.textContent, '提交');
  });

  it('skips password inputs', () => {
    const input = makePassword();
    const session = PageAdvisorPreview.createPreviewSession({
      resolveNid: () => input,
    });
    const r = session.applySuggestion({
      id: 's2',
      preview: { ops: [{ op: 'setAttr', nid: 'n2', attr: 'placeholder', value: 'x' }] },
    });
    assert.equal(r.applied, false);
  });

  it('second apply is idempotent', () => {
    const btn = makeButton('提交');
    const session = PageAdvisorPreview.createPreviewSession({
      resolveNid: () => btn,
    });
    const sug = { id: 's1', preview: { ops: [{ op: 'setText', nid: 'n1', value: 'X' }] } };
    assert.equal(session.applySuggestion(sug).applied, true);
    assert.equal(session.applySuggestion(sug).reason, 'already');
  });

  it('rebind after node replace re-applies preview', () => {
    const btn = makeButton('提交');
    const map = { n1: btn };
    const replacement = makeButton('提交', null);
    const root = {
      querySelector(sel) {
        if (String(sel).includes('n1') && replacement.getAttribute('data-taskplugin-nid') === 'n1') {
          return replacement;
        }
        return null;
      },
      querySelectorAll(sel) {
        const s = String(sel);
        if (s.includes('data-taskplugin-nid')) {
          return replacement.getAttribute('data-taskplugin-nid') ? [replacement] : [];
        }
        if (s.includes('button')) return [replacement];
        return [];
      },
    };
    const resolveNid = (nid) => map[nid] || root.querySelector(`[data-taskplugin-nid="${nid}"]`);
    const session = PageAdvisorPreview.createPreviewSession({ resolveNid });
    const sug = {
      id: 's1',
      target_nid: 'n1',
      anchor_text: '提交',
      preview: { ops: [{ op: 'setText', nid: 'n1', value: '立即提交' }] },
    };
    assert.equal(session.applySuggestion(sug).applied, true);
    assert.equal(btn.textContent, '立即提交');

    btn.isConnected = false;
    map.n1 = null;

    const outcome = PageAdvisorPreview.rebindSuggestionPreview(session, sug, {
      resolveNid,
      root,
      isSelected: () => true,
    });
    assert.equal(outcome, 'reapplied');
    assert.equal(replacement.textContent, '立即提交');
    assert.equal(replacement.getAttribute('data-taskplugin-nid'), 'n1');
    assert.equal(btn.textContent, '提交');
  });

  it('rebind undo leaves preview off when unchecked', () => {
    const btn = makeButton('保存');
    const map = { n1: btn };
    const session = PageAdvisorPreview.createPreviewSession({
      resolveNid: (nid) => map[nid] || null,
    });
    const sug = {
      id: 's2',
      target_nid: 'n1',
      anchor_text: '保存',
      preview: { ops: [{ op: 'setText', nid: 'n1', value: '已保存' }] },
    };
    session.applySuggestion(sug);
    btn.isConnected = false;
    map.n1 = null;
    const root = { querySelector: () => null, querySelectorAll: () => [] };
    const outcome = PageAdvisorPreview.rebindSuggestionPreview(session, sug, {
      resolveNid: (nid) => map[nid] || null,
      root,
      isSelected: () => false,
    });
    assert.equal(outcome, 'stale');
    assert.equal(session.has('s2'), false);
  });
});
