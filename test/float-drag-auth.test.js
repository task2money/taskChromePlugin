'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('float-drag-auth 不再隐式 resolveTaskOwner', () => {
  it('已删除 resolveTaskOwner（改由浮窗负责人下拉）', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'content', 'float-drag-auth.js'),
      'utf8',
    );
    assert.doesNotMatch(src, /function resolveTaskOwner/);
    assert.doesNotMatch(src, /无法确定任务负责人/);
  });
});
