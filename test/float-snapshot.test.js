'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

describe('float-snapshot 保留 ownerId', () => {
  it('captureOpenSnapshot 写入 ownerId', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'content', 'float-snapshot.js'),
      'utf8',
    );
    assert.match(src, /ownerId:\s*ownerSelect/);
    assert.match(src, /normalized\.ownerId/);
  });
});

describe('float-snapshot 语法完整性（OPT-20260918-024 回归）', () => {
  it('模板字面量改写后仍可解析（7f2cb58 曾漏删 esc( 的闭括号）', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'content', 'float-snapshot.js'),
      'utf8',
    );
    // 该缺陷下会抛 "Missing } in template expression"；先于浏览器加载失败暴露。
    assert.doesNotThrow(() => new vm.Script(src, { filename: 'content/float-snapshot.js' }));
  });
});

describe('float-snapshot 错误条可关闭', () => {
  it('错误结果带 dismiss，clearFloatResult 清空节点', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'content', 'float-snapshot.js'),
      'utf8',
    );
    assert.match(src, /function clearFloatResult\(/);
    assert.match(src, /function appendFloatResultDismiss\(/);
    assert.match(src, /taskplugin-result-dismiss/);
  });
});
