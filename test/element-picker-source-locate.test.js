'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { formatElementAdjustmentBlock } = require('../lib/element-picker.js');

function payload(over = {}) {
  return {
    pageUrl: 'https://ex.com/page',
    adjustment: '把按钮改成主色',
    element: { label: 'button#save', cssPath: 'main > button' },
    ...over,
  };
}

describe('element-picker source locate lines', () => {
  it('adds a high-confidence source line before the adjustment', () => {
    const block = formatElementAdjustmentBlock(payload({
      sourceLocations: [{ file: 'src/A.vue', line: 42, confidence: 'high' }],
    }));
    assert.match(block, /- \*\*源码定位\*\*: `src\/A\.vue:42`（source map，置信度高）/);
    assert.ok(block.indexOf('源码定位') < block.indexOf('调整期望'));
  });

  it('adds a medium-confidence source line', () => {
    const block = formatElementAdjustmentBlock(payload({
      sourceLocations: [{ file: 'src/B.tsx', line: 7, confidence: 'medium' }],
    }));
    assert.match(block, /- \*\*源码定位\*\*: `src\/B\.tsx:7`（source map，置信度中）/);
  });

  it('omits low-confidence and empty source locations', () => {
    const low = formatElementAdjustmentBlock(payload({
      sourceLocations: [{ file: 'src/C.ts', line: 1, confidence: 'low' }],
    }));
    assert.doesNotMatch(low, /源码定位/);
    const empty = formatElementAdjustmentBlock(payload({ sourceLocations: [] }));
    assert.doesNotMatch(empty, /源码定位/);
  });

  it('adds indexed source lines for disjoint multi-select', () => {
    const block = formatElementAdjustmentBlock(payload({
      element: {
        label: 'multi',
        selectionKind: 'disjoint',
        elements: [{ label: 'button.a' }, { label: 'button.b' }],
      },
      sourceLocations: [
        { file: 'src/A.vue', line: 1, confidence: 'high' },
        { file: 'src/B.vue', line: 2, confidence: 'medium' },
      ],
    }));
    assert.match(block, /- \*\*源码定位 1\*\*: `src\/A\.vue:1`/);
    assert.match(block, /- \*\*源码定位 2\*\*: `src\/B\.vue:2`/);
  });

  it('keeps the block unchanged when no source locations are supplied', () => {
    const block = formatElementAdjustmentBlock(payload());
    assert.doesNotMatch(block, /源码定位/);
    assert.match(block, /- \*\*调整期望\*\*: 把按钮改成主色/);
  });
});
