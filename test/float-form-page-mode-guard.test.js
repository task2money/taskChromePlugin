'use strict';

/**
 * float-form.js 页内模式加载不得抛错（OPT-20261008-003 回归）。
 *
 * 背景：v1.8.181 去掉页内悬浮球后，页内模式只注入调整弹窗、不再注入创建表单，
 * 于是 `#taskplugin-work-branch` / `#taskplugin-merge-target` / `#taskplugin-projects`
 * 等节点在页内模式下恒为 null。float-form.js 顶层的
 *   workBranch.addEventListener('change', …)
 *   mergeTarget.addEventListener('change', …)
 *   projectsDiv.addEventListener('change', …)
 * 未做空值守卫，会在 content script 顶层抛
 * "Cannot read properties of null (reading 'addEventListener')"，
 * 并中断本文件后续所有顶层绑定（含提交按钮）。
 *
 * 本用例在 vm 里用「表单节点全为 null」的真实页内模式上下文运行 float-form.js：
 * 修复前抛 TypeError（断言 1 失败，可复现缺陷），修复后正常跑完。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'content', 'float-form.js'), 'utf8');

function makeEl() {
  return { _on: {}, addEventListener(type, fn) { this._on[type] = fn; } };
}

/**
 * 运行 float-form.js。opts.present 为 true 时提供（side panel form 模式的）表单节点，
 * 为 false 时表单节点全为 null（页内模式）。
 */
function loadFloatForm(opts) {
  const present = !opts || opts.present !== false;
  const formEl = () => (present ? makeEl() : null);
  const context = {
    console,
    // float-boot.js 顶层声明的共享引用：页内模式下表单相关节点为 null。
    wsSelect: formEl(),
    featureParamsSelect: formEl(),
    workBranch: formEl(),
    mergeTarget: formEl(),
    projectsDiv: formEl(),
    autoRunInput: formEl(),
    imageSelect: formEl(),
    submitBtn: formEl(),
    // 处理器体内引用的函数（本用例只加载、不触发点击）。
    applyPresetIfNeeded() {},
    syncFloatAutoRun() {},
    syncFloatQueuedAutoRun() {},
    refreshFloatRepoBases() {},
    refreshFloatGitIdentities() {},
    syncDescResetButton() {},
    selectedFloatProjectIds: () => [],
  };
  vm.createContext(context);
  vm.runInContext(SRC, context, { filename: 'content/float-form.js' });
  return context;
}

describe('float-form.js 页内模式（表单节点缺失）加载', () => {
  it('页内模式加载不抛错', () => {
    assert.doesNotThrow(() => loadFloatForm({ present: false }));
  });

  it('form 模式（有表单节点）仍完成全部顶层绑定', () => {
    const ctx = loadFloatForm({ present: true });
    // 旧的未守卫写法在 form 模式下也要求这些绑定真实挂上，避免「守卫」把绑定一并吞掉。
    assert.equal(typeof ctx.workBranch._on.change, 'function');
    assert.equal(typeof ctx.mergeTarget._on.change, 'function');
    assert.equal(typeof ctx.projectsDiv._on.change, 'function');
  });
});
