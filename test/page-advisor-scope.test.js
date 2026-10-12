'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  allocateDomNid,
  queryNidWithinRoots,
  deepestTextMatch,
  parentNidIfInside,
} = require('../lib/page-advisor-scope.js');

const NID = 'data-taskplugin-nid';

function makeRegistry() {
  const nodes = [];
  const doc = {
    nodeType: 9,
    querySelector(sel) {
      const m = /data-taskplugin-nid="([^"]*)"/.exec(String(sel || ''));
      if (!m) return null;
      return nodes.find((n) => n.getAttribute(NID) === m[1]) || null;
    },
  };
  function make(tag, parent) {
    const attrs = {};
    const kids = [];
    const node = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      ownerDocument: doc,
      parentElement: parent || null,
      childNodes: kids,
      children: kids,
      hidden: false,
      style: {},
      textContent: '',
      getAttribute(name) {
        return attrs[name] == null ? null : String(attrs[name]);
      },
      setAttribute(name, value) {
        attrs[name] = String(value);
      },
      querySelector(sel) {
        const m = /data-taskplugin-nid="([^"]*)"/.exec(String(sel || ''));
        if (!m) return null;
        const walk = (el) => {
          for (const c of el.children) {
            if (c.getAttribute(NID) === m[1]) return c;
            const inner = walk(c);
            if (inner) return inner;
          }
          return null;
        };
        return walk(node);
      },
      querySelectorAll() {
        const out = [];
        const walk = (el) => {
          for (const c of el.children) {
            out.push(c);
            walk(c);
          }
        };
        walk(node);
        return out;
      },
      contains(el) {
        let cur = el;
        while (cur) {
          if (cur === node) return true;
          cur = cur.parentElement;
        }
        return false;
      },
    };
    if (parent) parent.children.push(node);
    nodes.push(node);
    return node;
  }
  return { doc, make, nodes };
}

describe('page-advisor-scope nid allocation', () => {
  beforeEach(() => {
    globalThis.__taskpluginNidSeq = 0;
  });

  it('does not reuse n1 when the document already has it', () => {
    const { make } = makeRegistry();
    const outside = make('button');
    outside.setAttribute(NID, 'n1');
    const picked = make('button');
    const nid = allocateDomNid(picked, NID);
    assert.notEqual(nid, 'n1');
    assert.equal(nid, 'n2');
  });

  it('keeps numbering across two selected roots', () => {
    const { make } = makeRegistry();
    const a = make('button');
    const b = make('button');
    const first = allocateDomNid(a, NID);
    a.setAttribute(NID, first);
    const second = allocateDomNid(b, NID);
    b.setAttribute(NID, second);
    assert.equal(first, 'n1');
    assert.equal(second, 'n2');
    assert.notEqual(first, second);
  });
});

describe('page-advisor-scope resolution stays inside the selection', () => {
  it('queryNidWithinRoots ignores an earlier duplicate outside the roots', () => {
    const { make } = makeRegistry();
    const outside = make('button');
    outside.setAttribute(NID, 'n1');
    const picked = make('section');
    const inner = make('button', picked);
    inner.setAttribute(NID, 'n1');
    inner.textContent = '结算';
    const found = queryNidWithinRoots('n1', [picked], NID);
    assert.equal(found, inner);
  });

  it('deepestTextMatch picks the inner node, not an ancestor that also contains the text', () => {
    const { make } = makeRegistry();
    const outside = make('main');
    outside.textContent = '结算';
    const picked = make('section');
    picked.textContent = '去结算';
    const inner = make('button', picked);
    inner.textContent = '去结算';
    const found = deepestTextMatch([picked], '去结算');
    assert.equal(found, inner);
  });

  it('parentNidIfInside blanks a parent outside the capture root', () => {
    const { make } = makeRegistry();
    const outside = make('main');
    const picked = make('section', outside);
    assert.equal(parentNidIfInside(picked, outside, 'n1'), '');
    assert.equal(parentNidIfInside(picked, picked, 'n2'), 'n2');
  });
});
