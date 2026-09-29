'use strict';

/**
 * 页面模式没有创建表单面板。Alt+X 不能在空面板上抛错，否则高亮框监听挂不上。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const vm = require('node:vm');

function extractFunction(src, name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start < 0) return null;
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

describe('element pick without page float panel', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'content', 'float-pick.js'), 'utf8');

  it('选元素先挂上指针监听，再改悬浮球，且不直接点 panel', () => {
    const body = extractFunction(src, 'setPickMode');
    assert.ok(body);
    const onBranch = body.slice(body.indexOf('} else {'));
    const releaseAt = onBranch.indexOf('releasePageFloatPanel()');
    const attachAt = onBranch.indexOf('attachPickPointerListeners()');
    assert.ok(releaseAt >= 0 && attachAt > releaseAt);
    assert.doesNotMatch(onBranch, /panel\.classList/);
  });

  it('没有面板时进入选元素不抛错，并挂上高亮监听', () => {
    const release = extractFunction(src, 'releasePageFloatPanel');
    const setPick = extractFunction(src, 'setPickMode');
    const calls = [];
    const ctx = {
      panel: null,
      btn: {
        textContent: '+',
        classList: {
          add(name) { calls.push(['add', name]); },
          remove(name) { calls.push(['remove', name]); },
        },
      },
      pickMode: false,
      pickSource: 'float',
      isOpen: true,
      document: {
        documentElement: {
          classList: { toggle(name, on) { calls.push(['toggle', name, on]); } },
        },
      },
      clearHighlight() {},
      clearPickSelection() { calls.push('clear'); },
      renderShortcutHints() { calls.push('hints'); },
      attachPickPointerListeners() { calls.push('attach'); },
      detachPickPointerListeners() {},
      chrome: { runtime: { sendMessage() { return Promise.resolve(); } } },
      console,
    };
    vm.createContext(ctx);
    vm.runInContext(`${release}\n${setPick}\nsetPickMode(true);`, ctx);
    assert.equal(ctx.pickMode, true);
    assert.equal(ctx.isOpen, false);
    assert.ok(calls.includes('attach'));
    assert.equal(ctx.btn.textContent, '✕');
  });
});
