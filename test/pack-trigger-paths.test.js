'use strict';

/**
 * 打包触发路径与打包清单同源：`pack-crx.sh` 打进 zip 的每个顶层目录，
 * 提交时必须能把 dist zip / Release 的打包带起来。
 *
 * 背景：`sidepanel/` 从 c24cd67 起就在 PACK_PATHS 里（发布包缺它加载会报
 * Side panel file path must exist），但 `.githooks/post-commit` 的触发清单一直没跟上：
 * 只改 `sidepanel/` 的提交不触发打包，修好的侧边栏永远发不出去。
 * 判据从 `pack-crx.sh` 的 PACK_PATHS 现算，不写死目录名——以后清单加目录，
 * 钩子不跟就红。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const POST_COMMIT = path.join(ROOT, '.githooks', 'post-commit');

/** `pack-crx.sh` 的 PACK_PATHS 清单（保序，去掉注释行）。 */
function packPaths() {
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'pack-crx.sh'), 'utf8');
  const block = script.match(/PACK_PATHS=\(([\s\S]*?)\n\)/);
  assert.ok(block, 'pack-crx.sh 中未找到 PACK_PATHS=(...) 清单');
  return block[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** 清单里的顶层目录（`background`、`sidepanel` …），文件项另算。 */
function packDirs() {
  return packPaths().filter((p) => !p.includes('.'));
}

/** post-commit 钩子里那条 `case` 分支的匹配式。 */
function postCommitPattern() {
  const hook = fs.readFileSync(POST_COMMIT, 'utf8');
  const m = hook.match(/^\s{4}(manifest\.json\|[^\n]*)\)\s*$/m);
  assert.ok(m, 'post-commit 中未找到打包触发路径的 case 分支');
  return m[1];
}

describe('打包触发路径', () => {
  it('判据本身没失效：清单与匹配式都读到了', () => {
    assert.ok(packPaths().length >= 10, `PACK_PATHS 条目过少: ${packPaths().length}`);
    assert.ok(postCommitPattern().includes('manifest.json'), '判据应读到 post-commit 的匹配式');
  });

  it('PACK_PATHS 里每个顶层目录都写进了 post-commit 触发清单', () => {
    const pattern = postCommitPattern();
    const missing = packDirs().filter((dir) => !pattern.split('|').includes(`${dir}/*`));
    assert.deepEqual(missing, [], `post-commit 漏了: ${missing.join(', ')}（只改这些目录的提交不会打包）`);
  });

  it('清单里的散文件也都在触发范围内', () => {
    const pattern = postCommitPattern();
    const files = packPaths().filter((p) => p.includes('.'));
    const missing = files.filter((f) => !pattern.split('|').includes(f));
    assert.deepEqual(missing, [], `post-commit 漏了: ${missing.join(', ')}`);
  });

  it('sidepanel 改动必须触发打包（本次回归的直接判据）', () => {
    assert.ok(packDirs().includes('sidepanel'), 'sidepanel 应在 PACK_PATHS 里');
    assert.ok(postCommitPattern().split('|').includes('sidepanel/*'), 'sidepanel/ 改动应触发打包');
  });
});
