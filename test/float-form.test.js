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

describe('float-form 显式负责人', () => {
  it('getMembers 带 workspaceId 且提交读 ownerSelect', () => {
    const form = fs.readFileSync(path.join(__dirname, '..', 'content', 'float-form.js'), 'utf8');
    assert.match(form, /getMembers',\s*\{\s*companyId:\s*cid,\s*workspaceId:\s*wsId\s*\}/);
    assert.match(form, /请选择负责人/);
    assert.match(form, /ownerSelect\?\.value/);
    assert.doesNotMatch(form, /无法确定任务负责人/);
  });

  it('markup 含 taskplugin-owner', () => {
    const markup = fs.readFileSync(path.join(__dirname, '..', 'lib', 'float-panel-markup.js'), 'utf8');
    assert.match(markup, /id="taskplugin-owner"/);
  });
});
