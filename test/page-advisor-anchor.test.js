'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ElementPicker 在 content_scripts 中先于本模块加载；单测显式 require 以复用标签/路径/HTML 片段。
require('../lib/element-picker.js');

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
          css_path: 'main > button#go.primary',
          label: 'button#go.primary',
          visible_text: '去结算',
          html_snippet: '<button id="go" class="primary">去结算</button>',
        },
      ],
    );
    assert.equal(items[0].id, 's1');
    assert.equal(items[0].dom_id, 'go');
    assert.equal(items[0].testid, 'go');
    assert.deepEqual(items[0].ancestor_nids, ['n1']);
    assert.equal(items[0].css_path, 'main > button#go.primary');
    assert.equal(items[0].label, 'button#go.primary');
    assert.equal(items[0].visible_text, '去结算');
    assert.match(items[0].html_snippet, /button id="go"/);
  });

  it('captures picker-style label, css path, visible text and HTML snippet', () => {
    const button = {
      nodeType: 1,
      tagName: 'BUTTON',
      id: 'go',
      className: 'primary taskplugin-el-highlight',
      parentElement: null,
      children: [],
      textContent: '去结算',
      outerHTML: '<button id="go" class="primary taskplugin-el-highlight" data-testid="go">去结算</button>',
      previousElementSibling: null,
      getAttribute(name) {
        if (name === 'id') return 'go';
        if (name === 'class') return this.className;
        if (name === 'data-testid') return 'go';
        return null;
      },
      closest() { return null; },
    };
    const main = {
      nodeType: 1,
      tagName: 'MAIN',
      id: '',
      className: '',
      parentElement: null,
      children: [button],
      textContent: '去结算',
      previousElementSibling: null,
      getAttribute() { return null; },
      closest() { return null; },
    };
    button.parentElement = main;
    const anchor = pageAdvisorDomAnchor(button);
    const { snapshotElement } = require('../lib/element-picker.js');
    assert.equal(anchor.id, 'go');
    assert.equal(anchor.testid, 'go');
    assert.equal(anchor.label, snapshotElement(button).label);
    assert.equal(anchor.label, 'button#go.primary.taskplugin-el-highlight');
    assert.match(anchor.css_path, /button#go/);
    assert.doesNotMatch(anchor.css_path, /taskplugin/);
    const escaped = {
      nodeType: 1,
      tagName: 'DIV',
      id: 'a.b',
      className: 'x:y',
      parentElement: null,
      children: [],
      textContent: 'z',
      outerHTML: '<div id="a.b" class="x:y">z</div>',
      previousElementSibling: null,
      getAttribute(name) {
        if (name === 'id') return 'a.b';
        if (name === 'class') return 'x:y';
        return null;
      },
      closest() { return null; },
    };
    const escapedAnchor = pageAdvisorDomAnchor(escaped);
    assert.equal(escapedAnchor.label, snapshotElement(escaped).label);
    assert.equal(escapedAnchor.label, 'div#a\\.b.x\\:y');
    assert.equal(anchor.visible_text, '去结算');
    assert.match(anchor.html_snippet, /去结算/);
    assert.doesNotMatch(anchor.html_snippet, /taskplugin-el-highlight/);
  });
});
