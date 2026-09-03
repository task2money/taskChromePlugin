'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('float-form loadWorkspaces 失败须带 data-traceId', () => {
  it('catch 路径调用 setDataTraceId(wsSelect, e)', () => {
    const form = fs.readFileSync(path.join(__dirname, '..', 'content', 'float-form.js'), 'utf8');
    const catchIdx = form.indexOf('loadWorkspaces 失败');
    assert.ok(catchIdx >= 0);
    const slice = form.slice(catchIdx, catchIdx + 500);
    assert.match(slice, /setDataTraceId\(wsSelect/);
  });
});
