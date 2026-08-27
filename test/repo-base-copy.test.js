'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { REPO_BASE_EMPTY_HINT } = require('../lib/create-task-payload.js');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('逐仓基准分支文案 — 一个任务一个项目', () => {
  it('共享空态提示不再写「选择项目后按仓库填写」', () => {
    assert.equal(REPO_BASE_EMPTY_HINT, '一个任务一个项目，按仓库填写');
    assert.doesNotMatch(REPO_BASE_EMPTY_HINT, /选择项目后/);
  });

  it('浮窗模板标签保持对齐工作面板，空态用单项目提示', () => {
    const markup = read('lib/float-panel-markup.js');
    assert.match(markup, /逐仓基准分支/);
    assert.match(markup, /对齐工作面板/);
    assert.match(markup, new RegExp(REPO_BASE_EMPTY_HINT));
    assert.doesNotMatch(markup, /选择项目后按仓库填写/);
  });

  it('content.js 空态与 emptyHint 引用共享文案，不残留旧句', () => {
    const content = read('content/content.js');
    assert.match(content, /REPO_BASE_EMPTY_HINT/);
    assert.doesNotMatch(content, /选择项目后按仓库填写/);
  });

  it('DevTools 单请求/批量面板空态与浮窗同一语义', () => {
    const html = read('panel/panel.html');
    assert.match(html, /一个任务一个项目，按仓库填写/);
    assert.doesNotMatch(html, /选择项目后按仓库填写/);
    const workspace = read('panel/lib/workspace.js');
    const batch = read('panel/tabs/batch.js');
    for (const src of [workspace, batch]) {
      assert.match(src, /REPO_BASE_EMPTY_HINT/);
      assert.doesNotMatch(src, /选择项目后按仓库填写/);
    }
  });
});
