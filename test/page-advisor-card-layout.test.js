'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Layout = require('../lib/page-advisor-card-layout.js');

const VIEW = { width: 1200, height: 800 };
const GAP = 8;

describe('page-advisor-card-layout rectsOverlap', () => {
  it('detects intersecting rects with gap', () => {
    assert.equal(
      Layout.rectsOverlap(
        { top: 10, left: 10, width: 100, height: 50 },
        { top: 40, left: 20, width: 100, height: 50 },
        GAP,
      ),
      true,
    );
  });

  it('allows abutting rects separated by gap', () => {
    assert.equal(
      Layout.rectsOverlap(
        { top: 10, left: 10, width: 100, height: 50 },
        { top: 10 + 50 + GAP, left: 10, width: 100, height: 50 },
        GAP,
      ),
      false,
    );
  });
});

describe('page-advisor-card-layout resolveAdvisorCardPositions (no auto-avoid)', () => {
  it('keeps two cards on the same preferred anchor (overlap allowed)', () => {
    const out = Layout.resolveAdvisorCardPositions(
      [
        {
          sid: 's1',
          order: 0,
          mode: 'anchored',
          preferredTop: 100,
          preferredLeft: 400,
          width: 260,
          height: 80,
        },
        {
          sid: 's2',
          order: 1,
          mode: 'anchored',
          preferredTop: 100,
          preferredLeft: 400,
          width: 260,
          height: 80,
        },
      ],
      VIEW,
      { gap: GAP },
    );
    assert.equal(out.length, 2);
    const a = out.find((c) => c.sid === 's1');
    const b = out.find((c) => c.sid === 's2');
    assert.equal(a.top, 100);
    assert.equal(a.left, 400);
    assert.equal(b.top, 100);
    assert.equal(b.left, 400);
  });

  it('keeps pinned card at user coords; anchored stays on preferred even if overlaps', () => {
    const out = Layout.resolveAdvisorCardPositions(
      [
        {
          sid: 'pin',
          order: 0,
          mode: 'pinned',
          preferredTop: 50,
          preferredLeft: 50,
          top: 200,
          left: 300,
          width: 260,
          height: 80,
        },
        {
          sid: 'auto',
          order: 1,
          mode: 'anchored',
          preferredTop: 200,
          preferredLeft: 300,
          width: 260,
          height: 80,
        },
      ],
      VIEW,
      { gap: GAP },
    );
    const pin = out.find((c) => c.sid === 'pin');
    const auto = out.find((c) => c.sid === 'auto');
    assert.equal(pin.mode, 'pinned');
    assert.equal(pin.top, 200);
    assert.equal(pin.left, 300);
    assert.equal(auto.top, 200);
    assert.equal(auto.left, 300);
  });

  it('places corner cards at their preferred stack offsets (caller supplies offsets)', () => {
    const out = Layout.resolveAdvisorCardPositions(
      [
        {
          sid: 'c0',
          order: 0,
          mode: 'corner',
          preferredTop: 640,
          preferredLeft: 900,
          width: 260,
          height: 80,
        },
        {
          sid: 'c1',
          order: 1,
          mode: 'corner',
          preferredTop: 544,
          preferredLeft: 900,
          width: 260,
          height: 80,
        },
      ],
      VIEW,
      { gap: GAP },
    );
    assert.equal(out[0].top, 640);
    assert.equal(out[1].top, 544);
    assert.equal(out[0].left, 900);
    assert.equal(out[1].left, 900);
  });

  it('clamps positions inside viewport', () => {
    const out = Layout.resolveAdvisorCardPositions(
      [
        {
          sid: 's1',
          order: 0,
          mode: 'anchored',
          preferredTop: -40,
          preferredLeft: 2000,
          width: 260,
          height: 80,
        },
      ],
      VIEW,
      { gap: GAP },
    );
    const c = out[0];
    assert.ok(c.top >= 8);
    assert.ok(c.left + c.width <= VIEW.width - 8);
  });
});
