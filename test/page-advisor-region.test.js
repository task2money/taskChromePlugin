'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  MIN_REGION_PX,
  normalizeRect,
  isValidRegion,
  rectsIntersect,
} = require('../lib/page-advisor-region.js');

describe('page-advisor-region normalizeRect', () => {
  it('normalizes inverted drag corners', () => {
    const r = normalizeRect({ x1: 100, y1: 80, x2: 20, y2: 10 });
    assert.deepEqual(r, { left: 20, top: 10, width: 80, height: 70 });
  });

  it('keeps already-ordered corners', () => {
    const r = normalizeRect({ x1: 0, y1: 0, x2: 50, y2: 40 });
    assert.deepEqual(r, { left: 0, top: 0, width: 50, height: 40 });
  });
});

describe('page-advisor-region isValidRegion', () => {
  it('rejects below MIN_REGION_PX', () => {
    assert.equal(isValidRegion({ left: 0, top: 0, width: MIN_REGION_PX - 1, height: 100 }), false);
    assert.equal(isValidRegion({ left: 0, top: 0, width: 100, height: MIN_REGION_PX - 1 }), false);
  });

  it('accepts at least MIN on both axes', () => {
    assert.equal(isValidRegion({ left: 0, top: 0, width: MIN_REGION_PX, height: MIN_REGION_PX }), true);
  });
});

describe('page-advisor-region rectsIntersect', () => {
  it('detects overlap', () => {
    assert.equal(
      rectsIntersect(
        { left: 0, top: 0, width: 50, height: 50 },
        { left: 40, top: 40, width: 20, height: 20 },
      ),
      true,
    );
  });

  it('rejects disjoint', () => {
    assert.equal(
      rectsIntersect(
        { left: 0, top: 0, width: 10, height: 10 },
        { left: 20, top: 20, width: 10, height: 10 },
      ),
      false,
    );
  });
});
