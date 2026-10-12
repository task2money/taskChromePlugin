'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  allocateDomNid,
  scopeRootsWithFrames,
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
      querySelectorAll(sel) {
        const out = [];
        const walk = (el) => {
          for (const c of el.children) {
            out.push(c);
            walk(c);
          }
        };
        walk(node);
        const tag = String(sel || '').trim().toUpperCase();
        if (!tag || tag === '*') return out;
        return out.filter((el) => el.tagName === tag);
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

const rect = (top, left, width, height) => ({
  top, left, width, height, bottom: top + height, right: left + width,
});

/** 外层 section 包一个 iframe；子文档是一套自己的注册表。 */
function makeFrameHost({ crossOrigin = false, sectionRect = rect(0, 0, 500, 500), frameRect = rect(40, 40, 200, 120) } = {}) {
  const host = makeRegistry();
  const section = host.make('section');
  section.getBoundingClientRect = () => sectionRect;
  const frame = host.make('iframe', section);
  frame.getBoundingClientRect = () => frameRect;
  const sub = makeRegistry();
  const subHtml = sub.make('html');
  sub.doc.documentElement = subHtml;
  if (crossOrigin) {
    Object.defineProperty(frame, 'contentDocument', {
      get() { throw new Error('SecurityError: cross-origin'); },
    });
  } else {
    frame.contentDocument = sub.doc;
  }
  return { host, section, frame, sub, subHtml };
}

describe('page-advisor-scope 把同源 iframe 子文档算进选区（OPT-20261012-032）', () => {
  it('外层容器带相交的同源 iframe 时，子文档根也进选区', () => {
    const { section, subHtml } = makeFrameHost();
    const roots = scopeRootsWithFrames([section]);
    assert.equal(roots[0], section, '点选的根排在第一位');
    assert.ok(roots.includes(subHtml), '同源子文档根进了选区');
  });

  it('iframe 里的编号与文案都能在外层容器选区里找到', () => {
    const h = makeFrameHost();
    const btn = h.sub.make('button', h.subHtml);
    btn.setAttribute(NID, 'n7');
    btn.textContent = '去结算';
    const roots = scopeRootsWithFrames([h.section]);
    assert.equal(queryNidWithinRoots('n7', roots, NID), btn, '标记落在 iframe 内的按钮上');
    assert.equal(deepestTextMatch(roots, '去结算'), btn);
  });

  it('不带子文档扩展的选区仍然找不到 iframe 里的编号', () => {
    const h = makeFrameHost();
    const btn = h.sub.make('button', h.subHtml);
    btn.setAttribute(NID, 'n7');
    assert.equal(queryNidWithinRoots('n7', [h.section], NID), null, '只查外层容器会落空');
  });

  it('跨域 iframe 不进选区', () => {
    const { section } = makeFrameHost({ crossOrigin: true });
    assert.deepEqual(scopeRootsWithFrames([section]), [section]);
  });

  it('零尺寸与不相交的 iframe 不进选区', () => {
    const hidden = makeFrameHost({ frameRect: rect(40, 40, 0, 0) });
    assert.deepEqual(scopeRootsWithFrames([hidden.section]), [hidden.section]);

    const away = makeFrameHost({ frameRect: rect(900, 900, 200, 120) });
    assert.deepEqual(scopeRootsWithFrames([away.section]), [away.section]);
  });
});
