'use strict';

/**
 * pre-commit 暂存被并发清空时失败（OPT-20261012-012）。
 *
 * 插件 pre-commit 要跑约半分钟随机单测；这段时间里另一进程对同一工作树执行
 * git reset 会清空暂存，钩子仍返回成功，git 就写出与父提交同树的空提交，随后
 * 的 GitHub Release 会指向没有对应改动的提交。这里把插件钩子原样装进临时仓：
 *   1. 钩子运行期间暂存被清空 → 提交失败，且不产生空提交；
 *   2. 暂存全程保留 → 提交正常通过。
 * 清空是「由被钩子执行的测试文件自己触发」的，不依赖 sleep 抢时序，故不 flaky。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function gitEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) {
    delete env[key];
  }
  return env;
}

function git(dir, args) {
  return execFileSync(
    'git',
    ['-C', dir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args],
    { encoding: 'utf8', env: gitEnv() },
  );
}

/** 临时仓，装入插件真实钩子与共享守卫；package.json 的 test 为 no-op。 */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-staged-guard-'));
  fs.mkdirSync(path.join(dir, '.githooks', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.githooks', 'pre-commit'), path.join(dir, '.githooks', 'pre-commit'));
  fs.copyFileSync(
    path.join(ROOT, '.githooks', 'lib', 'rt_assert_staged_preserved.sh'),
    path.join(dir, '.githooks', 'lib', 'rt_assert_staged_preserved.sh'),
  );
  fs.chmodSync(path.join(dir, '.githooks', 'pre-commit'), 0o755);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"scratch","version":"1.0.0","scripts":{"test":"exit 0"}}\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'scratch\n');
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'core.hooksPath', '.githooks']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'chore: base']);
  return dir;
}

/** 被钩子执行、并自我清空暂存的测试文件：确定性地复现并发 reset。 */
function selfClearingTest(dir) {
  return [
    "'use strict';",
    "const { execFileSync } = require('node:child_process');",
    "const { test } = require('node:test');",
    `test('clears the index mid-hook', () => { execFileSync('git', ['-C', ${JSON.stringify(dir)}, 'reset', '-q']); });`,
    '',
  ].join('\n');
}

/** 被钩子执行、并在窗口内 `git add` 一个旁路文件的测试文件：
 *  确定性地复现「并发会话追加暂存条目」（OPT-20261014-013）。 */
function selfStagingTest(dir) {
  return [
    "'use strict';",
    "const fs = require('node:fs');",
    "const { execFileSync } = require('node:child_process');",
    "const { test } = require('node:test');",
    `test('stages a sibling file mid-hook', () => { fs.writeFileSync(${JSON.stringify(path.join(dir, 'theirs.txt'))}, 'theirs\\n'); execFileSync('git', ['-C', ${JSON.stringify(dir)}, 'add', 'theirs.txt']); });`,
    '',
  ].join('\n');
}

/**
 * 直接跑钩子脚本本身（不经 `git commit`）：commit 期间 git 会把 GIT_INDEX_FILE
 * 指向 next-index 临时索引，被钩子执行的测试再 reset 就落不到钩子读的那个索引上，
 * 判据会随 git 版本漂移。裸跑钩子时索引就是仓的常规索引，行为确定。
 */
function runHook(dir) {
  // 钩子内部会再跑 `node --test`。若带上外层 runner 的 NODE_TEST_CONTEXT，
  // node 会判定为嵌套并「skipping running files」，被钩子执行的测试根本不会跑，
  // 判据随之失真。这里为被 spawn 的钩子剥掉嵌套标记。
  const env = gitEnv();
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const result = spawnSync('bash', [path.join(dir, '.githooks', 'pre-commit')], {
    cwd: dir,
    encoding: 'utf8',
    env,
  });
  return { status: result.status, stderr: String(result.stderr || ''), stdout: String(result.stdout || '') };
}

describe('plugin pre-commit staged-index guard', () => {
  it('钩子运行期间暂存被清空 → 钩子非 0 退出（git 会因此不写空提交）', () => {
    const dir = makeRepo();
    try {
      const before = git(dir, ['rev-parse', 'HEAD']).trim();
      fs.writeFileSync(path.join(dir, 'test', 'clears.test.js'), selfClearingTest(dir));
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'doc\n');
      git(dir, ['add', 'test/clears.test.js', 'notes.txt']);

      const result = runHook(dir);
      assert.notEqual(result.status, 0, `钩子不应成功：${result.stdout}${result.stderr}`);
      assert.match(`${result.stdout}${result.stderr}`, /staged index was cleared during pre-commit/);
      assert.equal(git(dir, ['rev-parse', 'HEAD']).trim(), before, '暂存清空后不得推进 HEAD');
      assert.equal(git(dir, ['diff', '--cached', '--name-only']).trim(), '', '暂存确已被清空');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // OPT-20261014-013：只比数量会静默放行「窗口内被追加」的条目——并发会话在
  // 随机单测跑的这半分钟里 git add 的文件会被裹挟进本人提交（真实事故形态：
  // 2026-10-14 两起，双方门禁全绿）。这里让被钩子执行的测试自己 git add 一个
  // 旁路文件，确定性地复现「新增」。
  it('钩子运行期间暂存被追加 → 钩子非 0 退出（不裹挟他人条目）', () => {
    const dir = makeRepo();
    try {
      const before = git(dir, ['rev-parse', 'HEAD']).trim();
      fs.writeFileSync(path.join(dir, 'test', 'stages.test.js'), selfStagingTest(dir));
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'doc\n');
      git(dir, ['add', 'test/stages.test.js', 'notes.txt']);

      const result = runHook(dir);
      assert.notEqual(result.status, 0, `钩子不应成功：${result.stdout}${result.stderr}`);
      assert.match(`${result.stdout}${result.stderr}`, /索引在门禁期间被并发会话修改/);
      assert.match(`${result.stdout}${result.stderr}`, /theirs\.txt/);
      assert.equal(git(dir, ['rev-parse', 'HEAD']).trim(), before, '不得推进 HEAD');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('暂存全程保留 → 钩子 0 退出、暂存仍在', () => {
    const dir = makeRepo();
    try {
      fs.writeFileSync(path.join(dir, 'test', 'harmless.test.js'), "const { test } = require('node:test');\ntest('ok', () => {});\n");
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'doc\n');
      git(dir, ['add', 'test/harmless.test.js', 'notes.txt']);

      const result = runHook(dir);
      assert.equal(result.status, 0, `钩子应通过：${result.stdout}${result.stderr}`);
      assert.match(result.stdout, /pre-commit checks passed/);
      assert.equal(git(dir, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean).length, 2, '暂存应原样保留');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
