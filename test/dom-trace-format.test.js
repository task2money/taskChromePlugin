'use strict';

// OPT-20260920-035 回归：请求失败文案必须带可见 traceId 行（约束 24）。
// 仅挂 data-traceId 时，用户复制纯文本到聊天里 Agent 提取不到 trace，无法 Loki 检索。

const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');

function loadDomTrace() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'lib', 'dom-trace.js'), 'utf8'),
    sandbox,
    { filename: 'lib/dom-trace.js' },
  );
  return sandbox;
}

describe('dom-trace.formatErrorWithTraceId', () => {
  it('有 traceId 时在文案末行追加可见 traceId:', () => {
    const s = loadDomTrace();
    assert.equal(typeof s.formatErrorWithTraceId, 'function');
    assert.equal(
      s.formatErrorWithTraceId('保存失败', 'abc-123'),
      '保存失败\ntraceId: abc-123',
    );
  });

  it('接受对象来源（traceId / trace_id）', () => {
    const s = loadDomTrace();
    assert.equal(s.formatErrorWithTraceId('x', { traceId: ' t1 ' }), 'x\ntraceId: t1');
    assert.equal(s.formatErrorWithTraceId('x', { trace_id: 't2' }), 'x\ntraceId: t2');
  });

  it('无 traceId 时原样返回，不追加空行', () => {
    const s = loadDomTrace();
    assert.equal(s.formatErrorWithTraceId('保存失败', ''), '保存失败');
    assert.equal(s.formatErrorWithTraceId('保存失败', null), '保存失败');
    assert.equal(s.formatErrorWithTraceId('保存失败', {}), '保存失败');
  });

  it('文案已含 traceId 时不重复追加', () => {
    const s = loadDomTrace();
    const msg = '保存失败 traceId: pre-existing';
    assert.equal(s.formatErrorWithTraceId(msg, 'abc-123'), msg);
  });

  it('空文案不产生仅有 traceId 的行', () => {
    const s = loadDomTrace();
    assert.equal(s.formatErrorWithTraceId('', 'abc'), '');
    assert.equal(s.formatErrorWithTraceId(null, 'abc'), '');
  });

  it('不破坏既有 extractTraceId / setDataTraceId 导出', () => {
    const s = loadDomTrace();
    assert.equal(typeof s.extractTraceId, 'function');
    assert.equal(typeof s.setDataTraceId, 'function');
  });
});

describe('失败出口复用 formatErrorWithTraceId（源码断言）', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  it('content/float-snapshot.js showResult error 分支调用它', () => {
    const src = read('content/float-snapshot.js');
    assert.match(src, /type === 'error' && typeof formatErrorWithTraceId === 'function'/);
    assert.match(src, /formatErrorWithTraceId\(msg, traceId\)/);
  });

  it('popup/popup.js showResult error 分支调用它', () => {
    const src = read('popup/popup.js');
    assert.match(src, /type === 'error' && typeof formatErrorWithTraceId === 'function'/);
    assert.match(src, /formatErrorWithTraceId\(msg, traceId\)/);
  });

  it('page-advisor 错误出口复用同一实现（单源化，不再内联拼接）', () => {
    const src = read('content/float-page-advisor.js');
    assert.match(src, /formatErrorWithTraceId\(msg,\s*tid\)/);
    assert.doesNotMatch(src, /text\s*=\s*`\$\{text\}\\ntraceId: \$\{tid\}`/);
  });

  it('dom-trace.js 在 float-snapshot.js 之前注入（且 popup.html 已引入）', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const content = manifest.content_scripts || [];
    const order = content.flatMap((cs) => cs.js || []);
    const iTrace = order.findIndex((p) => p.includes('dom-trace.js'));
    const iSnapshot = order.findIndex((p) => p.includes('float-snapshot.js'));
    assert.ok(iTrace >= 0, 'manifest 必须包含 lib/dom-trace.js');
    assert.ok(iSnapshot >= 0, 'manifest 必须包含 content/float-snapshot.js');
    assert.ok(iTrace < iSnapshot, 'dom-trace.js 必须先于 float-snapshot.js 加载');
    assert.match(read('popup/popup.html'), /lib\/dom-trace\.js/);
  });
});
