'use strict';

/**
 * 子 frame 指针选择：⌘/Ctrl 多选走 pointerdown，避免 click 剥修饰键。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const pickFrame = fs.readFileSync(path.join(__dirname, '..', 'content', 'pick-frame.js'), 'utf8');

describe('pick-frame additive multi-select', () => {
  it('attaches pointerdown/click/contextmenu to the same gesture helper', () => {
    assert.match(pickFrame, /addEventListener\('pointerdown',\s*onPickSelectEvent,\s*true\)/);
    assert.match(pickFrame, /addEventListener\('click',\s*onPickSelectEvent,\s*true\)/);
    assert.match(pickFrame, /addEventListener\('contextmenu',\s*onPickSelectEvent,\s*true\)/);
    assert.match(pickFrame, /pickGestureKind\(/);
    assert.doesNotMatch(pickFrame, /function onClick\(/);
  });
});
