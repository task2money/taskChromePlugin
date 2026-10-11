'use strict';

/**
 * 发布 tag 漂移修正（OPT-20261012-006）。
 *
 * publish-github-release.sh 发现 tag 已存在时只上传附件并改说明，不改 --target；
 * v1.8.237 的标签曾留在上一提交，样式修复在下一提交，于是「按标签检出的树」与
 * 「下载的 zip」不是同一棵，且 GitLab/GitHub 的 tag 与 Release target 各说各话。
 *
 * 这里在临时仓 + 本地 bare「远端」上驱动 scripts/retarget-release-tag.sh，锁定：
 *   1. 漂移时把该 tag ref 强制移到目标提交（轻量 tag 与注解 tag 都要）；
 *   2. 已经指向目标时幂等无改动；
 *   3. 只动这个 tag，绝不移动被跟踪分支；
 *   4. --check 只比对不写、漂移 exit 1；未知参数 exit 2。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'retarget-release-tag.sh');

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

function run(dir, args) {
  const result = spawnSync('bash', [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: gitEnv(),
  });
  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function head(dir, ref = 'HEAD') {
  return git(dir, ['rev-parse', ref]).trim();
}

/** 本地 bare 「远端」 + 一个已推送两次提交、带 tag 的工作仓。 */
function makeRepo(tagArgs) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-retarget-'));
  const remote = path.join(base, 'remote.git');
  const work = path.join(base, 'work');
  fs.mkdirSync(remote);
  git(remote, ['init', '--bare', '-b', 'main']);
  git(base, ['clone', remote, work]);
  fs.writeFileSync(path.join(work, 'manifest.json'), '{}\n');
  git(work, ['add', '-A']);
  git(work, ['commit', '-m', 'chore: first']);
  const stale = head(work);
  git(work, ['tag', ...tagArgs, 'v1.0.0', stale]);
  git(work, ['push', 'origin', 'main', '--tags']);
  // 下一次提交：tag 发布后才落地的修复提交，这正是 1.8.237 场景
  fs.writeFileSync(path.join(work, 'fix.txt'), 'fix\n');
  git(work, ['add', '-A']);
  git(work, ['commit', '-m', 'fix: later fix']);
  git(work, ['push', 'origin', 'main']);
  return { base, remote, work, stale, fix: head(work) };
}

function remoteTag(work, tag) {
  return git(work, ['ls-remote', 'origin', `refs/tags/${tag}`]).trim().split(/\s+/)[0] || '';
}

describe('retarget-release-tag.sh', () => {
  it('轻量 tag 漂移时强制移到本次提交，且不动 main', () => {
    const ctx = makeRepo([]);
    try {
      const before = head(ctx.work, 'origin/main');
      const result = run(ctx.work, ['--remote', 'origin', '--tag', 'v1.0.0']);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(head(ctx.work, 'refs/tags/v1.0.0'), ctx.fix);
      assert.equal(remoteTag(ctx.work, 'v1.0.0'), ctx.fix);
      assert.equal(head(ctx.work, 'origin/main'), before, 'main 不应被移动');
    } finally {
      fs.rmSync(ctx.base, { recursive: true, force: true });
    }
  });

  it('注解 tag 也剥离到提交后移动', () => {
    const ctx = makeRepo(['-a', '-m', 'release v1.0.0']);
    try {
      const result = run(ctx.work, ['--remote', 'origin', '--tag', 'v1.0.0']);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(remoteTag(ctx.work, 'v1.0.0'), ctx.fix);
    } finally {
      fs.rmSync(ctx.base, { recursive: true, force: true });
    }
  });

  it('已指向目标时幂等，不产生新推送', () => {
    const ctx = makeRepo([]);
    try {
      assert.equal(run(ctx.work, ['--remote', 'origin', '--tag', 'v1.0.0']).status, 0);
      const second = run(ctx.work, ['--remote', 'origin', '--tag', 'v1.0.0']);
      assert.equal(second.status, 0, second.stderr);
      assert.match(second.stderr, /已指向/);
      assert.equal(remoteTag(ctx.work, 'v1.0.0'), ctx.fix);
    } finally {
      fs.rmSync(ctx.base, { recursive: true, force: true });
    }
  });

  it('--check 只比对不写：漂移 exit 1 且 tag 不动，纠回后 exit 0', () => {
    const ctx = makeRepo([]);
    try {
      const drift = run(ctx.work, ['--remote', 'origin', '--tag', 'v1.0.0', '--check']);
      assert.equal(drift.status, 1);
      assert.match(drift.stderr, /DRIFT/);
      assert.equal(remoteTag(ctx.work, 'v1.0.0'), ctx.stale, '--check 不得改动 tag');

      assert.equal(run(ctx.work, ['--remote', 'origin', '--tag', 'v1.0.0']).status, 0);
      const ok = run(ctx.work, ['--remote', 'origin', '--tag', 'v1.0.0', '--check']);
      assert.equal(ok.status, 0, ok.stderr);
    } finally {
      fs.rmSync(ctx.base, { recursive: true, force: true });
    }
  });

  it('tag 尚不存在时为 no-op（交给创建路径）', () => {
    const ctx = makeRepo([]);
    try {
      const result = run(ctx.work, ['--remote', 'origin', '--tag', 'v9.9.9']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /还没有/);
      assert.equal(remoteTag(ctx.work, 'v9.9.9'), '');
    } finally {
      fs.rmSync(ctx.base, { recursive: true, force: true });
    }
  });

  it('未知参数 exit 2，缺少必填参数 exit 2', () => {
    const ctx = makeRepo([]);
    try {
      assert.equal(run(ctx.work, ['--mirror-everything']).status, 2);
      assert.equal(run(ctx.work, ['--remote', 'origin']).status, 2);
    } finally {
      fs.rmSync(ctx.base, { recursive: true, force: true });
    }
  });
});
