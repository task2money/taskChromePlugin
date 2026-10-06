'use strict';

/**
 * Alt+X 后 ⌘/Ctrl 多选：修饰键判定与 pointerdown/click 分工。
 * 复现：click 上 ctrlKey/metaKey 被剥掉时不得当成普通单击结束选择。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAdditivePickModifier,
  isPrimaryPickPointer,
  pickGestureKind,
  PICK_CLICK_SUPPRESS_MS,
} = require('../lib/pick-additive-modifier.js');

describe('isAdditivePickModifier', () => {
  it('treats ctrlKey or metaKey as additive', () => {
    assert.equal(isAdditivePickModifier({ ctrlKey: true }), true);
    assert.equal(isAdditivePickModifier({ metaKey: true }), true);
    assert.equal(isAdditivePickModifier({ ctrlKey: false, metaKey: false }), false);
    assert.equal(isAdditivePickModifier(null), false);
  });

  it('uses getModifierState when click flags are stripped', () => {
    const e = {
      ctrlKey: false,
      metaKey: false,
      getModifierState(name) {
        return name === 'Control' || name === 'Accel';
      },
    };
    assert.equal(isAdditivePickModifier(e), true);
  });

  it('reads Meta via getModifierState', () => {
    const e = {
      ctrlKey: false,
      metaKey: false,
      getModifierState(name) {
        return name === 'Meta';
      },
    };
    assert.equal(isAdditivePickModifier(e), true);
  });
});

describe('pickGestureKind after Alt+X', () => {
  it('pointerdown with Control toggles; stripped click is suppress not finish', () => {
    const down = {
      type: 'pointerdown',
      button: 0,
      ctrlKey: true,
    };
    assert.equal(pickGestureKind(down, 1000, 0, 400), 'toggle');
    const click = {
      type: 'click',
      button: 0,
      ctrlKey: false,
      metaKey: false,
    };
    assert.equal(
      pickGestureKind(click, 1012, 1000, 400),
      'suppress',
      'click 剥掉 ctrlKey 后不得 finish 单选',
    );
  });

  it('plain pointerdown finishes single pick', () => {
    const down = { type: 'pointerdown', button: 0, ctrlKey: false, metaKey: false };
    assert.equal(pickGestureKind(down, 2000, 0, 400), 'finish');
  });

  it('Mac ctrl contextmenu toggles', () => {
    const menu = { type: 'contextmenu', button: 2, ctrlKey: true };
    assert.equal(pickGestureKind(menu, 3000, 0, 400), 'toggle');
    assert.equal(isPrimaryPickPointer(menu), true);
  });

  it('exports suppress window constant', () => {
    assert.ok(PICK_CLICK_SUPPRESS_MS >= 200);
  });
});
