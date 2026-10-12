'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { capture } = require('../lib/page-context-rect.js');

describe('page-context-rect capture', () => {
  it('stamps and reads only the leaf that intersects the rectangle', () => {
    const outside = {
      nodeType: 1,
      tagName: 'BUTTON',
      children: [],
      childNodes: [],
      parentElement: null,
    };
    const inside = {
      nodeType: 1,
      tagName: 'BUTTON',
      children: [],
      childNodes: [],
      parentElement: null,
    };
    const root = {
      nodeType: 1,
      tagName: 'DIV',
      children: [outside, inside],
      childNodes: [outside, inside],
    };
    outside.parentElement = root;
    inside.parentElement = root;
    const rects = new Map([
      [root, { left: 0, top: 0, width: 400, height: 40 }],
      [outside, { left: 0, top: 0, width: 40, height: 20 }],
      [inside, { left: 200, top: 0, width: 40, height: 20 }],
    ]);
    const stamped = [];
    const ctx = capture({
      region: { left: 180, top: 0, width: 80, height: 30 },
      url: 'https://example.test/page',
      title: 'rect',
      root,
      stampNids: true,
      getBoundingClientRect: (el) => rects.get(el),
    }, {
      capturePageContext: () => {
        throw new Error('invalid region should be the only fallback');
      },
      isElementSkipped: () => false,
      stampDomNids: (el) => stamped.push(el),
      extractVisibleReadableText: (el) => (el === inside ? 'IN' : 'OUT'),
      truncatePageText: (raw) => ({ text: raw, truncated: false }),
      captureDomOutline: () => [],
      maxNodes: 20,
    });
    assert.equal(ctx.regionScoped, true);
    assert.equal(ctx.pageText, 'IN');
    assert.deepEqual(stamped, [inside]);
  });
});
