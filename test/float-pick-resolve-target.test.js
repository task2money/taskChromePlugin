'use strict';

/**
 * OPT-20261006-027：合成 pointerdown 若 clientX/Y 未对准元素，deepElementFromPoint
 * 的 hit-test 会命中无关元素并盖过 composedPath 目标，令 Ctrl 多选静默丢目标。
 * resolvePickTarget 必须以 composedPath 为准，仅在 hit-test 落在 composed 子树内
 * （open shadow 穿透）时才采信更深结果。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'content', 'float-pick.js'), 'utf8');

function extractFunction(source, name) {
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

function el(id, children = []) {
  return {
    nodeType: 1,
    id,
    tagName: 'DIV',
    contains(other) {
      if (other === this) return true;
      return children.some((c) => c.contains(other));
    },
  };
}

function resolve(composed, deep) {
  const ctx = {
    console,
    document: {},
    isPluginDom: () => false,
    ElementPicker: {
      resolveComposedElement: () => composed,
      deepElementFromPoint: () => deep,
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    `${extractFunction(src, 'resolvePickTarget')}\n__result = resolvePickTarget({ clientX: 1, clientY: 1 });`,
    ctx,
  );
  return ctx.__result;
}

describe('resolvePickTarget 坐标失配时以 composedPath 为准', () => {
  it('hit-test 命中无关元素（错误坐标）时选 dispatch 目标', () => {
    const target = el('target');
    const unrelated = el('unrelated');
    const r = resolve(target, { el: unrelated, closedShadow: false });
    assert.equal(r.el, target);
  });

  it('hit-test 命中 composed 子树内更深元素时采信更深结果（shadow 穿透）', () => {
    const inner = el('inner');
    const host = el('host', [inner]);
    const r = resolve(host, { el: inner, closedShadow: true });
    assert.equal(r.el, inner);
    assert.equal(r.closedShadow, true);
  });

  it('hit-test 未命中时不回退到无关元素', () => {
    const target = el('target');
    const r = resolve(target, { el: null, closedShadow: false });
    assert.equal(r.el, target);
  });
});
