'use strict';

/**
 * 指针选择：⌘/Ctrl 多选必须在 pointerdown 判定修饰键。
 * Alt+X 后 click 上的 ctrlKey/metaKey 常被浏览器剥掉，只听 click 会变成立刻单选。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'content', 'float-pick.js'), 'utf8');
const pickFrame = fs.readFileSync(path.join(__dirname, '..', 'content', 'pick-frame.js'), 'utf8');
const region = fs.readFileSync(
  path.join(__dirname, '..', 'content', 'float-page-advisor-region.js'),
  'utf8',
);
const { pickGestureKind, PICK_CLICK_SUPPRESS_MS } = require('../lib/pick-additive-modifier.js');
const { toggleDisjointSelection } = require('../lib/element-picker.js');

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing function ${name}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed function ${name}`);
}

function makeEvt(type, el, mods) {
  return {
    type,
    button: 0,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    _el: el,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  };
}

describe('Ctrl/Cmd multi-select uses pointerdown', () => {
  it('float-pick attaches pointerdown and contextmenu in pick mode', () => {
    assert.match(src, /addEventListener\('pointerdown',\s*onPickSelectEvent,\s*true\)/);
    assert.match(src, /addEventListener\('contextmenu',\s*onPickSelectEvent,\s*true\)/);
    assert.match(src, /pickGestureKind\(/);
    assert.match(src, /if \(typeof btn !== 'undefined' && btn\) btn\.title = tip/);
  });

  it('pick-frame uses the same gesture helper', () => {
    assert.match(pickFrame, /addEventListener\('pointerdown'/);
    assert.match(pickFrame, /pickGestureKind\(/);
  });

  it('region select uses the same gesture helper', () => {
    assert.match(region, /addEventListener\('pointerdown'/);
    assert.match(region, /pickGestureKind\(/);
  });

  it('e2e LIB_FILES load pick-additive-modifier before float-pick', () => {
    const e2eDir = path.join(__dirname, '..', 'e2e');
    const files = fs.readdirSync(e2eDir).filter((f) => f.endsWith('.playwright.test.js'));
    const missing = [];
    for (const f of files) {
      const text = fs.readFileSync(path.join(e2eDir, f), 'utf8');
      if (!text.includes("'content/float-pick.js'")) continue;
      if (!text.includes("'lib/pick-additive-modifier.js'")) missing.push(f);
    }
    assert.deepEqual(missing, [], `float-pick e2e 未注入修饰键模块: ${missing.join(', ')}`);
  });
});

describe('onPickSelectEvent accumulates Ctrl multi-select', () => {
  it('Ctrl pointerdown twice keeps two elements; stripped click does not finish', () => {
    const a = { nodeType: 1, id: 'a', ownerDocument: {} };
    const b = { nodeType: 1, id: 'b', ownerDocument: a.ownerDocument };
    const sandbox = {
      pickMode: true,
      lastPickGestureAt: 0,
      pickSelection: [],
      pickSelectionFrame: null,
      pickCrossOriginHintShown: false,
      btn: null,
      PICK_CLICK_SUPPRESS_MS,
      Date: { now: () => sandbox._now },
      _now: 1000,
      console,
      ElementPicker: { toggleDisjointSelection },
      pickGestureKind,
      isPluginDom: () => false,
      showResult() {},
      applyHighlightMany() {},
      finished: [],
    };
    sandbox.setPickMode = (on) => {
      sandbox.pickMode = !!on;
    };
    const code = [
      extractNamedFunction(src, 'clearPickSelection'),
      extractNamedFunction(src, 'samePickFrame'),
      'function resolvePickTarget(e) {',
      '  return { el: e._el, frameElement: e._frame || null, crossOrigin: false, closedShadow: false };',
      '}',
      'function finishPickWithElements(els) {',
      '  finished.push((els || []).map(function (x) { return x.id; }));',
      '  pickMode = false;',
      '}',
      extractNamedFunction(src, 'onPickSelectEvent'),
      'onPickSelectEvent;',
    ].join('\n');
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);

    sandbox._now = 1000;
    vm.runInContext('onPickSelectEvent(_evt)', Object.assign(sandbox, { _evt: makeEvt('pointerdown', a, { ctrl: true }) }));
    sandbox._now = 1012;
    vm.runInContext('onPickSelectEvent(_evt)', Object.assign(sandbox, { _evt: makeEvt('click', a, {}) }));
    sandbox._now = 1500;
    vm.runInContext('onPickSelectEvent(_evt)', Object.assign(sandbox, { _evt: makeEvt('pointerdown', b, { ctrl: true }) }));
    sandbox._now = 1510;
    vm.runInContext('onPickSelectEvent(_evt)', Object.assign(sandbox, { _evt: makeEvt('click', b, {}) }));

    assert.equal(sandbox.pickMode, true);
    assert.deepEqual(sandbox.finished, []);
    assert.deepEqual(sandbox.pickSelection.map((el) => el.id), ['a', 'b']);
  });

  it('确认快照时先摘掉悬停高亮 class，用完还原（OPT-20261007-010）', () => {
    const { withoutPickHighlight } = require('../lib/element-picker.js');
    const snapshotCalls = [];
    const sandbox = {
      setPickMode() {},
      openAdjustModal() {},
      viewportRectForElements() { return null; },
      ElementPicker: {
        withoutPickHighlight,
        snapshotElement(el) {
          snapshotCalls.push([el.id, String(el.className)]);
          return { label: String(el.className) };
        },
        snapshotDisjointSelection(els) { return { elements: els }; },
      },
    };
    const code = [
      'var pickSelection = [];',
      'var pickSelectionFrame = null;',
      extractNamedFunction(src, 'clearPickSelection'),
      extractNamedFunction(src, 'finishPickWithElements'),
      'finishPickWithElements;',
    ].join('\n');
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);

    const classes = new Set(['primary', 'taskplugin-el-highlight']);
    const el = {
      nodeType: 1,
      id: 'go',
      className: 'primary taskplugin-el-highlight',
      classList: {
        contains: (c) => classes.has(c),
        add: (c) => { classes.add(c); el.className = [...classes].join(' '); },
        remove: (c) => { classes.delete(c); el.className = [...classes].join(' '); },
      },
    };
    vm.runInContext('finishPickWithElements(_el, null, false)', Object.assign(sandbox, { _el: el }));

    assert.deepEqual(snapshotCalls, [['go', 'primary']]);
    assert.ok(classes.has('taskplugin-el-highlight'), '高亮 class 用完应还原');
    assert.equal(sandbox.pendingElementSnapshot.label, 'primary');
  });
});
