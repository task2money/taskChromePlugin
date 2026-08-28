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

const UNIFIED_COPY = '一个任务一个项目，空则用项目默认分支';

describe('逐仓基准分支文案 — 单项目 + 空则用默认分支', () => {
  it('共享空态提示统一为「单项目 + 空则用默认分支」', () => {
    assert.equal(REPO_BASE_EMPTY_HINT, UNIFIED_COPY);
    assert.doesNotMatch(REPO_BASE_EMPTY_HINT, /选择项目后/);
    assert.doesNotMatch(REPO_BASE_EMPTY_HINT, /按仓库填写/);
  });

  it('浮窗模板与 DevTools 共用同一字符串（单项目 + 空则用默认分支）', () => {
    const markup = read('lib/float-panel-markup.js');
    const html = read('panel/panel.html');
    assert.match(markup, /逐仓基准分支/);
    assert.match(markup, /对齐工作面板；空则用项目默认分支/);
    assert.match(markup, new RegExp(UNIFIED_COPY));
    assert.match(html, /对齐工作面板；空则用项目默认分支/);
    assert.match(html, new RegExp(UNIFIED_COPY));
    // 同一字符串出现在浮窗与 panel.html（OPT-20260827-046 对齐目标）
    assert.match(markup, new RegExp(REPO_BASE_EMPTY_HINT));
  });

  it('content.js 空态与 emptyHint 引用共享文案，不残留旧句', () => {
    const { readContentBundle } = require('./helpers/contentBundle.js');
    const content = readContentBundle();
    assert.match(content, /REPO_BASE_EMPTY_HINT/);
    assert.doesNotMatch(content, /选择项目后按仓库填写/);
    assert.doesNotMatch(content, /一个任务一个项目，按仓库填写/);
  });

  it('浮窗选定项目后填充逐仓基准分支 datalist', () => {
    const { readContentBundle } = require('./helpers/contentBundle.js');
    const content = readContentBundle();
    assert.match(content, /populateFloatRepoBaseDatalists/);
    assert.match(content, /refreshFloatRepoBases/);
  });

  it('branch-datalist.js 在 payload 之前注入（panel / manifest / SW）', () => {
    const html = read('panel/panel.html');
    const man = JSON.parse(read('manifest.json'));
    const sw = read('background/service-worker.js');
    const scripts = man.content_scripts[0].js;
    assert.ok(scripts.indexOf('lib/branch-datalist.js') >= 0);
    assert.ok(scripts.indexOf('lib/branch-datalist.js') < scripts.indexOf('lib/create-task-payload.js'));
    assert.ok(html.indexOf('branch-datalist.js') < html.indexOf('create-task-payload.js'));
    assert.ok(sw.indexOf('branch-datalist.js') < sw.indexOf('create-task-payload.js'));
  });

  it('create-task-payload 不重复声明 const BranchDatalist（importScripts 同作用域）', () => {
    const src = read('lib/create-task-payload.js');
    assert.doesNotMatch(src, /const BranchDatalist\b/);
    assert.match(src, /RepoBaseBranchDatalist/);
  });

  it('DevTools 单请求/批量面板空态与浮窗同一语义', () => {
    const html = read('panel/panel.html');
    assert.match(html, new RegExp(UNIFIED_COPY));
    assert.doesNotMatch(html, /选择项目后按仓库填写/);
    assert.doesNotMatch(html, /一个任务一个项目，按仓库填写/);
    const workspace = read('panel/lib/workspace.js');
    const batch = read('panel/tabs/batch.js');
    for (const src of [workspace, batch]) {
      assert.match(src, /REPO_BASE_EMPTY_HINT/);
      assert.doesNotMatch(src, /选择项目后按仓库填写/);
    }
  });
});
