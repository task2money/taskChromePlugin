'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_PAGE_TEXT_RUNES,
  truncatePageText,
  isElementSkipped,
  extractVisibleReadableText,
  capturePageContext,
} = require('../lib/page-context.js');

function textNode(value, parent) {
  return { nodeType: 3, nodeValue: value, parentElement: parent, childNodes: [] };
}

function el(tag, { attrs = {}, style = {}, children = [], hidden = false } = {}) {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    hidden,
    style,
    childNodes: [],
    parentElement: null,
    getAttribute(name) {
      return attrs[name] != null ? String(attrs[name]) : null;
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
