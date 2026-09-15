'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_PAGE_TEXT_RUNES,
  truncatePageText,
  isElementSkipped,
  extractVisibleReadableText,
  capturePageContext,
  capturePageContextInRect,
} = require('../lib/page-context.js');

function textNode(value, parent) {
  return { nodeType: 3, nodeValue: value, parentElement: parent, childNodes: [] };
}

function el(tag, { attrs = {}, style = {}, children = [], hidden = false, id = '' } = {}) {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    id: id || (attrs.id != null ? String(attrs.id) : ''),
    hidden,
    style,
    childNodes: [],
    parentElement: null,
    getAttribute(name) {
      return attrs[name] != null ? String(attrs[name]) : null;
    },
    closest(selector) {
      const want = String(selector || '').startsWith('#')
        ? String(selector).slice(1)
        : null;
      let cur = node;
      while (cur) {
        if (want && cur.id === want) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
  };
  for (const c of children) {
    if (c.nodeType === 3) c.parentElement = node;
    else c.parentElement = node;
    node.childNodes.push(c);
  }
  return node;
}

describe('page-context truncatePageText', () => {
  it('returns unchanged when under limit', () => {
    const { text, truncated } = truncatePageText('hello');
    assert.equal(text, 'hello');
    assert.equal(truncated, false);
  });

  it('truncates by rune count at 32KiB default', () => {
    const long = 'あ'.repeat(MAX_PAGE_TEXT_RUNES + 10);
    const { text, truncated } = truncatePageText(long);
    assert.equal(truncated, true);
    assert.equal(Array.from(text).length, MAX_PAGE_TEXT_RUNES);
  });

  it('respects custom maxRunes', () => {
    const { text, truncated } = truncatePageText('abcdef', 3);
    assert.equal(text, 'abc');
    assert.equal(truncated, true);
  });
});

describe('page-context extractVisibleReadableText', () => {
  it('skips script/style and hidden nodes', () => {
    const root = el('div', {
      children: [
        el('p', { children: [textNode('visible')] }),
        el('script', { children: [textNode('evil()')] }),
        el('style', { children: [textNode('.x{}')] }),
        el('div', { style: { display: 'none' }, children: [textNode('hidden')] }),
        el('span', { attrs: { 'aria-hidden': 'true' }, children: [textNode('aria')] }),
        el('div', { hidden: true, children: [textNode('attr-hidden')] }),
        el('p', { children: [textNode('  more  text ')] }),
      ],
    });
    const out = extractVisibleReadableText(root);
    assert.equal(out, 'visible more text');
    assert.ok(!out.includes('evil'));
    assert.ok(!out.includes('hidden'));
  });

  it('isElementSkipped recognizes SKIP tags', () => {
    assert.equal(isElementSkipped(el('script')), true);
    assert.equal(isElementSkipped(el('p')), false);
  });
});

describe('page-context capturePageContext', () => {
  it('returns url title pageText with truncation flag', () => {
    const root = el('body', {
      children: [el('p', { children: [textNode('hello world')] })],
    });
    const ctx = capturePageContext({
      url: 'https://example.com/x',
      title: 'Example',
      root,
    });
    assert.equal(ctx.url, 'https://example.com/x');
    assert.equal(ctx.title, 'Example');
    assert.equal(ctx.pageText, 'hello world');
    assert.equal(ctx.pageTextTruncated, false);
  });
});

describe('page-context capturePageContextInRect', () => {
  it('only includes text from elements intersecting the region', () => {
    const left = el('p', { children: [textNode('LEFT')] });
    const right = el('p', { children: [textNode('RIGHT')] });
    const root = el('body', { children: [left, right] });
    const rects = new Map([
      [left, { left: 0, top: 0, width: 40, height: 20 }],
      [right, { left: 100, top: 0, width: 40, height: 20 }],
      [root, { left: 0, top: 0, width: 200, height: 40 }],
    ]);
    const ctx = capturePageContextInRect({
      url: 'https://example.com/r',
      title: 'Region',
      root,
      region: { left: 0, top: 0, width: 50, height: 30 },
      stampNids: false,
      getBoundingClientRect: (node) => rects.get(node) || { left: 0, top: 0, width: 0, height: 0 },
    });
    assert.equal(ctx.regionScoped, true);
    assert.match(ctx.pageText, /LEFT/);
    assert.doesNotMatch(ctx.pageText, /RIGHT/);
  });

  it('excludes #taskplugin-float-root so region suggest never optimizes the float panel', () => {
    const page = el('p', { children: [textNode('HOST_PAGE')] });
    const floatLabel = el('label', { children: [textNode('工作空间')] });
    const floatRoot = el('div', {
      id: 'taskplugin-float-root',
      children: [floatLabel],
    });
    const root = el('body', { children: [page, floatRoot] });
    const rects = new Map([
      [page, { left: 0, top: 0, width: 100, height: 40 }],
      [floatLabel, { left: 10, top: 10, width: 80, height: 20 }],
      [floatRoot, { left: 0, top: 0, width: 200, height: 200 }],
      [root, { left: 0, top: 0, width: 400, height: 400 }],
    ]);
    const ctx = capturePageContextInRect({
      url: 'https://example.com/host',
      title: 'Host',
      root,
      region: { left: 0, top: 0, width: 200, height: 200 },
      stampNids: false,
      getBoundingClientRect: (node) => rects.get(node) || { left: 0, top: 0, width: 0, height: 0 },
    });
    assert.match(ctx.pageText, /HOST_PAGE/);
    assert.doesNotMatch(ctx.pageText, /工作空间/);
  });
});

describe('page-context extractVisibleReadableText skips plugin chrome', () => {
  it('skips float-root subtree for full-page Alt+E capture', () => {
    const page = el('p', { children: [textNode('PAGE_OK')] });
    const floatInner = el('span', { children: [textNode('FLOAT_NO')] });
    const floatRoot = el('div', { id: 'taskplugin-float-root', children: [floatInner] });
    const root = el('body', { children: [page, floatRoot] });
    const text = extractVisibleReadableText(root);
    assert.match(text, /PAGE_OK/);
    assert.doesNotMatch(text, /FLOAT_NO/);
  });
});
