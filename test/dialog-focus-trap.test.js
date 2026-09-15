'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const DialogFocusTrap = require('../lib/dialog-focus-trap.js');

function makeElement(tag, attrs = {}) {
  return {
    tagName: tag.toUpperCase(),
    hidden: false,
    focusCalls: 0,
    focus() { this.focusCalls += 1; },
    getAttribute(name) {
      return attrs[name] != null ? attrs[name] : null;
    },
    contains() { return true; },
    querySelectorAll(sel) {
      void sel;
      return [];
    },
  };
}

describe('dialog-focus-trap', () => {
  afterEach(() => {
    DialogFocusTrap.deactivateFocusTrap({ restoreFocus: false });
  });

  it('focusFirstFocusable focuses first matching control', () => {
    const btn = makeElement('button');
    const container = {
      querySelectorAll(sel) {
        assert.match(sel, /button/);
        return [btn];
      },
    };
    assert.equal(DialogFocusTrap.focusFirstFocusable(container), true);
    assert.equal(btn.focusCalls, 1);
  });

  it('activateFocusTrap runs onEscape and returns focus', () => {
    const returnBtn = makeElement('button');
    let escaped = false;
    const container = {
      contains: () => true,
      querySelectorAll: () => [makeElement('button')],
    };
    const events = [];
    const doc = {
      activeElement: null,
      addEventListener(type, fn, capture) {
        events.push({ type, fn, capture });
      },
      removeEventListener(type, fn, capture) {
        const i = events.findIndex((e) => e.fn === fn);
        if (i >= 0) events.splice(i, 1);
        void type;
        void capture;
      },
    };
    const prevDoc = global.document;
    global.document = doc;

    try {
      DialogFocusTrap.activateFocusTrap(container, {
        returnFocusEl: returnBtn,
        onEscape: () => { escaped = true; },
      });
      const handler = events[0]?.fn;
      assert.ok(typeof handler === 'function');
      handler({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
      assert.equal(escaped, true);
      assert.equal(returnBtn.focusCalls, 1);
    } finally {
      global.document = prevDoc;
    }
  });
});
