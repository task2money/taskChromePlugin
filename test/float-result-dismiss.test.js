'use strict';

/**
 * 浮窗错误条（含无库存链接）上的 × 只关掉提示，不收起面板。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function makeEl(tag) {
  return {
    tagName: tag,
    className: '',
    textContent: '',
    type: '',
    title: '',
    href: '',
    target: '',
    rel: '',
    children: [],
    attrs: {},
    listeners: {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren() {
      this.children = [];
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    querySelector(sel) {
      const walk = (node) => {
        if (!node || !node.children) return null;
        for (const child of node.children) {
          if (sel === 'a' && child.tagName === 'a') return child;
          if (sel === 'button.taskplugin-result-dismiss'
            && child.tagName === 'button'
            && String(child.className).includes('taskplugin-result-dismiss')) {
            return child;
          }
          const nested = walk(child);
          if (nested) return nested;
        }
        return null;
      };
      return walk(this);
    },
  };
}

function loadShowResult() {
  const resultDiv = makeEl('div');
  const sandbox = {
    resultDiv,
    document: {
      createElement: (tag) => makeEl(tag),
      createTextNode: (text) => ({ tagName: '#text', textContent: String(text), children: [] }),
    },
    setDataTraceId(el, tid) {
      if (tid) el.setAttribute('data-traceId', tid);
      else el.removeAttribute('data-traceId');
    },
    formatErrorWithTraceId: (msg) => msg,
    tx: (key) => (key === 'floatDismissResult' ? '关闭提示' : key),
    clearTimeout,
    setTimeout,
  };
  vm.runInNewContext(
    `${fs.readFileSync(path.join(ROOT, 'content/float-snapshot.js'), 'utf8')}\n;`
    + 'this.showResult = showResult;'
    + 'this.clearFloatResult = clearFloatResult;',
    sandbox,
  );
  return { sandbox, resultDiv };
}

describe('float result dismiss', () => {
  it('out-of-stock link notice closes on × and keeps the panel state', () => {
    const { sandbox, resultDiv } = loadShowResult();
    sandbox.showResult('项目「Alpha」暂无库存', 'error', '', {
      kind: 'link',
      before: '项目',
      linkText: '「Alpha」',
      href: 'https://aidevpush.com/tenant/ten-1/projects/p1/',
      after: '暂无库存',
    });
    assert.match(resultDiv.className, /taskplugin-show/);
    assert.ok(!resultDiv._tcpClear);
    const dismiss = resultDiv.querySelector('button.taskplugin-result-dismiss');
    assert.ok(dismiss, '错误条应有关闭按钮');
    assert.equal(dismiss.attrs['aria-label'], '关闭提示');
    const anchor = resultDiv.querySelector('a');
    assert.equal(anchor.href, 'https://aidevpush.com/tenant/ten-1/projects/p1/');
    dismiss.listeners.click({ preventDefault() {}, stopPropagation() {} });
    assert.equal(resultDiv.className, 'taskplugin-result');
    assert.equal(resultDiv.children.length, 0);
    assert.equal(resultDiv.querySelector('a'), null);
  });

  it('ball × close path clears the result the same way as the header', () => {
    const drag = fs.readFileSync(path.join(ROOT, 'content/float-drag-auth.js'), 'utf8');
    const close = fs.readFileSync(path.join(ROOT, 'content/content.js'), 'utf8');
    assert.match(drag, /clearFloatResult\(\)/);
    assert.match(close, /function hideFloatPanel\(\)[\s\S]*clearFloatResult\(\)/);
  });
});
