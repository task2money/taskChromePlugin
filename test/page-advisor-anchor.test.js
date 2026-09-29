'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  pageAdvisorCssPath,
  pageAdvisorDomAnchor,
  attachSuggestionAnchors,
} = require('../lib/page-advisor-anchor.js');

function el(tag, { id = '', attrs = {}, children = [] } = {}) {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    id,
    parentElement: null,
    children: [],
    textContent: '',
    getAttribute(name) {
      if (name === 'id') return id || null;
      return attrs[name] != null ? String(attrs[name]) : null;
    },
  };
  for (const child of children) {
    child.parentElement = node;
    node.children.push(child);
    node.textContent += child.textContent || '';
  }
  return node;
}

describe('page-advisor-anchor', () => {
  it('builds an nth-child path capped at 8 and stops at main', () => {
    const button = el('button', { id: 'go', attrs: { 'data-testid': 'go' } });
    button.textContent = '去结算';
    const section = el('section', { children: [el('span'), button] });
    const main = el('main', { children: [section] });
    const body = el('body', { children: [main] });
    void body;
    const path = pageAdvisorCssPath(button);
    assert.match(path, /^main > section:nth-child\(1\) > button:nth-child\(2\)$/);
    const anchor = pageAdvisorDomAnchor(button);
    assert.equal(anchor.id, 'go');
    assert.equal(anchor.testid, 'go');
    assert.match(anchor.landmark, /main/);
  });

  it('drops ancestor segments beyond 8', () => {
    let child = el('button');
    let node = child;
    for (let i = 0; i < 12; i += 1) {
      node = el('div', { children: [node] });
    }
    const path = pageAdvisorCssPath(child);
    assert.equal(path.split(' > ').length, 8);
    assert.match(path, /button:nth-child\(1\)$/);
  });

  it('freezes outline fields onto the suggestion by target_nid', () => {
    const items = attachSuggestionAnchors(
      [{ id: 's1', title: 'A', target_nid: 'n2', anchor_text: '去结算' }],
      [
        { nid: 'n1', tag: 'main', parent_nid: '', text: '页', id: '', testid: '', aria_label: '', landmark: '', css_path: 'main' },
        {
          nid: 'n2',
          tag: 'button',
          parent_nid: 'n1',
          text: '去结算',
          id: 'go',
          testid: 'go',
          aria_label: '',
          landmark: 'main',
          css_path: 'main > button:nth-child(1)',
        },
      ],
    );
    assert.equal(items[0].id, 's1');
    assert.equal(items[0].dom_id, 'go');
    assert.equal(items[0].testid, 'go');
    assert.deepEqual(items[0].ancestor_nids, ['n1']);
    assert.equal(items[0].css_path, 'main > button:nth-child(1)');
  });
});
