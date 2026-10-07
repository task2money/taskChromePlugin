'use strict';

/**
 * e2e/helpers/manifest-content-scripts.js 单测（OPT-20261008-003）。
 *
 * 该 helper 是自包含 e2e 的注入面 SSOT：从 manifest.json 读取 content_scripts
 * 的 js 顺序，避免各用例手抄 LIB_FILES 与新文件漂移（曾漏抄
 * content/float-page-advisor-fill-ui.js 致点击抛 confirmPageAdvisorFill is not defined）。
 * 这里锁住「返回的就是 manifest 声明顺序、且每个文件真实存在」。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { manifestContentScripts } = require('../e2e/helpers/manifest-content-scripts.js');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

describe('manifestContentScripts', () => {
  it('默认取主文档链（all_frames 非真）且顺序与 manifest 一致', () => {
    const entry = manifest.content_scripts.find((e) => e && e.all_frames !== true);
    assert.deepEqual(manifestContentScripts(), entry.js);
  });

  it('返回非空路径列表，且每个文件在插件根真实存在', () => {
    const files = manifestContentScripts();
    assert.ok(files.length > 0);
    for (const rel of files) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `manifest 声明的脚本缺失：${rel}`);
    }
  });

  it('可按 index 取 all_frames 条目（pick-frame 注入组）', () => {
    const idx = manifest.content_scripts.findIndex((e) => e && e.all_frames === true);
    assert.ok(idx >= 0);
    assert.deepEqual(
      manifestContentScripts({ index: idx }),
      manifest.content_scripts[idx].js,
    );
  });
});
