'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  REPO_BASE_EMPTY_HINT,
  REPO_BASE_HINT,
  REPO_BASE_LABEL,
} = require('../lib/create-task-payload.js');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('基准分支文案 — 单仓 + 空则用默认分支', () => {
  it('共享空态/副文案不再写「逐仓」或「对齐工作面板」', () => {
    assert.equal(REPO_BASE_LABEL, '基准分支');
    assert.equal(REPO_BASE_HINT, '空则用项目默认分支');
    assert.equal(REPO_BASE_EMPTY_HINT, REPO_BASE_HINT);
    assert.doesNotMatch(REPO_BASE_LABEL, /逐仓/);
    assert.doesNotMatch(REPO_BASE_HINT, /对齐工作面板/);
    assert.doesNotMatch(REPO_BASE_EMPTY_HINT, /按仓库填写/);
  });

  it('浮窗与 DevTools 标签均为「基准分支」且 hint 为单仓空则默认', () => {
    const markup = read('lib/float-panel-markup.js');
    const html = read('panel/panel.html');
    for (const src of [markup, html]) {
      assert.match(src, new RegExp(REPO_BASE_LABEL));
      assert.match(src, new RegExp(REPO_BASE_HINT));
      assert.match(src, new RegExp(REPO_BASE_EMPTY_HINT));
      assert.doesNotMatch(src, /逐仓基准分支/);
      assert.doesNotMatch(src, /对齐工作面板/);
    }
  });

  it('content.js 空态与 emptyHint 引用共享文案，不残留旧句', () => {
    const { readContentBundle } = require('./helpers/contentBundle.js');
    const content = readContentBundle();
    assert.match(content, /REPO_BASE_EMPTY_HINT/);
    assert.doesNotMatch(content, /选择项目后按仓库填写/);
    assert.doesNotMatch(content, /一个任务一个项目，按仓库填写/);
  });

  it('浮窗选定项目后填充基准分支 datalist', () => {
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
    assert.match(html, new RegExp(REPO_BASE_EMPTY_HINT));
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
