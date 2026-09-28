'use strict';

/**
 * Gitee 第二同步源配置（OPT-20260928-006）。
 *
 * 镜像 remote 只写在本机 .git/config，换机器或重新克隆后会丢；日常 `git push`
 * 只到 GitHub origin，Gitee 会再次落后。这里在临时仓里驱动
 * scripts/ensure-gitee-mirror.sh，锁定三件事：
 *   1. 幂等补齐 remote gitee 与 origin 的第二条 pushurl；
 *   2. 绝不改写 origin 的 fetch URL 与首条 pushurl；
 *   3. --check / --no-pushurl / 跳过开关的行为。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ensure-gitee-mirror.sh');

const MIRROR = 'git@gitee.com:ljy-ruandao/task-chrome-plugin-test.git';
const GITHUB = 'git@github.com:task2money/taskChromePlugin.git';

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
    ['-C', dir, '-c', 'user.email=mirror@example.com', '-c', 'user.name=mirror', ...args],
    { encoding: 'utf8', env: gitEnv() },
  );
}

/** 跑一次 ensure 脚本，返回 { status, stdout, stderr }（非 0 不抛）。 */
function runMirror(dir, args = [], extraEnv = {}) {
  const result = spawnSync('bash', [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: gitEnv({ TASK_CHROME_PLUGIN_GITEE_URL: MIRROR, ...extraEnv }),
  });
  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function pushUrls(dir) {
  try {
    return git(dir, ['config', '--get-all', 'remote.origin.pushurl']).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-gitee-mirror-'));
  git(dir, ['init', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{\n  "manifest_version": 3,\n  "version": "1.0.0"\n}\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'chore: base']);
  // 真实场景里 origin 已存在且指向 GitHub；镜像 URL 另走 remote gitee
  git(dir, ['remote', 'add', 'origin', GITHUB]);
  return dir;
}

describe('ensure-gitee-mirror.sh', () => {
  it('首次运行补齐 remote gitee 与 origin push 目标，且不动 origin fetch', () => {
    const dir = makeRepo();
    try {
      const result = runMirror(dir);
      assert.equal(result.status, 0, result.stderr);

      assert.equal(git(dir, ['remote', 'get-url', 'gitee']).trim(), MIRROR);
      // 关键：pushurl 一旦设置就取代隐式 fetch URL 作为推送目标，
      // 所以必须是 [GitHub, Gitee] 两条，缺一 GitHub 就收不到 push。
      assert.deepEqual(pushUrls(dir), [GITHUB, MIRROR]);
      assert.equal(git(dir, ['remote', 'get-url', 'origin']).trim(), GITHUB);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('重复运行幂等：不重复追加 pushurl，第二次无改动', () => {
    const dir = makeRepo();
    try {
      assert.equal(runMirror(dir).status, 0);
      const second = runMirror(dir);
      assert.equal(second.status, 0, second.stderr);
      assert.match(second.stderr, /已是最新/);
      assert.deepEqual(pushUrls(dir), [GITHUB, MIRROR]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--check 未配置时 exit 1，补齐后 exit 0', () => {
    const dir = makeRepo();
    try {
      const missing = runMirror(dir, ['--check']);
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, /MISSING remote gitee/);

      assert.equal(runMirror(dir).status, 0);
      const ok = runMirror(dir, ['--check']);
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stderr, /ensure-gitee-mirror: OK/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('remote gitee 漂移时 --check 报错，补齐运行纠正回 SSOT URL', () => {
    const dir = makeRepo();
    try {
      git(dir, ['remote', 'add', 'gitee', 'git@gitee.com:someone/else.git']);
      const drift = runMirror(dir, ['--check']);
      assert.equal(drift.status, 1);
      assert.match(drift.stderr, /DRIFT/);

      assert.equal(runMirror(dir).status, 0);
      assert.equal(git(dir, ['remote', 'get-url', 'gitee']).trim(), MIRROR);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--no-pushurl 与跳过开关都只补 remote，不给 origin 挂镜像', () => {
    const dir = makeRepo();
    try {
      assert.equal(runMirror(dir, ['--no-pushurl']).status, 0);
      assert.equal(git(dir, ['remote', 'get-url', 'gitee']).trim(), MIRROR);
      assert.deepEqual(pushUrls(dir), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    const dir2 = makeRepo();
    try {
      assert.equal(runMirror(dir2, [], { TASK_CHROME_PLUGIN_SKIP_GITEE_PUSHURL: '1' }).status, 0);
      assert.equal(git(dir2, ['remote', 'get-url', 'gitee']).trim(), MIRROR);
      assert.deepEqual(pushUrls(dir2), []);
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('已有首条 pushurl 时只在其后追加，不覆盖', () => {
    const dir = makeRepo();
    try {
      const primary = 'git@github.com:task2money/taskChromePlugin-push.git';
      git(dir, ['config', '--add', 'remote.origin.pushurl', primary]);
      assert.equal(runMirror(dir).status, 0);
      assert.deepEqual(pushUrls(dir), [primary, MIRROR]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pushurl 只剩镜像（GitHub 会收不到 push）时 --check 判为 ERROR 并纠回', () => {
    const dir = makeRepo();
    try {
      // 复现「只加了一条 Gitee」的危险态：fetch URL 不在 pushurl 列表里
      git(dir, ['config', '--add', 'remote.origin.pushurl', MIRROR]);
      const broken = runMirror(dir, ['--check']);
      assert.equal(broken.status, 1);
      assert.match(broken.stderr, /origin 将推不到 GitHub/);

      assert.equal(runMirror(dir).status, 0);
      assert.deepEqual(pushUrls(dir), [GITHUB, MIRROR]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('未知参数退出 2，不静默执行', () => {
    const dir = makeRepo();
    try {
      const result = runMirror(dir, ['--mirror-everything']);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /未知参数/);
      assert.deepEqual(pushUrls(dir), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
