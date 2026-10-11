'use strict';

/**
 * Release 附件「先删同名再上传」（OPT-20261012-005）。
 *
 * gh release upload --clobber 在附件同名时返回 422，post-commit 只告警，于是旧
 * zip 留在 Release 上，用户下到的仍是上一版产物。用桩 gh 驱动真实脚本，锁定：
 *   1. 同名旧 asset 先删除、后上传（顺序）；
 *   2. 不同名的历史 asset 不误删；
 *   3. 附件缺失 / 参数错误以非 0 退出，不静默。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'publish-release-assets.sh');

const GH_STUB = `#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
case "$1 $2" in
  "release view")
    if [ -n "\${GH_VIEW_ASSETS:-}" ]; then printf '%s\\n' "$GH_VIEW_ASSETS"; fi
    ;;
esac
exit 0
`;

/** 临时目录：桩 gh（记录每次调用）+ 两个假附件。 */
function makeEnv(assets = ['task-chrome-plugin-v1.2.3.zip']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-release-assets-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), GH_STUB, { mode: 0o755 });
  for (const a of assets) fs.writeFileSync(path.join(dir, a), 'zip-bytes\n');
  return { dir, bin, log: path.join(dir, 'gh.log') };
}

function run(dir, bin, log, args, viewAssets = '') {
  const result = spawnSync('bash', [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      GH_LOG: log,
      GH_VIEW_ASSETS: viewAssets,
    },
  });
  let calls = [];
  if (fs.existsSync(log)) {
    calls = fs
      .readFileSync(log, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }
  return { status: result.status, stdout: String(result.stdout || ''), stderr: String(result.stderr || ''), calls };
}

const ok = (calls) => calls.join('\n');

describe('publish-release-assets.sh', () => {
  it('同名旧 asset 先删后传，其余历史 asset 不动', () => {
    const { dir, bin, log } = makeEnv(['task-chrome-plugin-v1.2.3.zip', 'task-chrome-plugin-v1.2.3.crx']);
    try {
      const result = run(
        dir,
        bin,
        log,
        [
          '--repo', 'task2money/taskChromePlugin',
          '--tag', 'v1.2.3',
          '--asset', path.join(dir, 'task-chrome-plugin-v1.2.3.zip'),
          '--asset', path.join(dir, 'task-chrome-plugin-v1.2.3.crx'),
        ],
        'task-chrome-plugin-v1.2.3.zip\ntask-chrome-plugin-v1.1.0.zip',
      );
      assert.equal(result.status, 0, result.stderr);
      const order = ok(result.calls);
      const delIdx = order.indexOf('release delete-asset v1.2.3 task-chrome-plugin-v1.2.3.zip');
      const upIdx = order.indexOf('release upload v1.2.3');
      assert.ok(delIdx >= 0, `应删除同名旧 zip：\n${order}`);
      assert.ok(upIdx >= 0, `应执行上传：\n${order}`);
      assert.ok(delIdx < upIdx, '删除必须在上传之前');
      assert.doesNotMatch(order, /delete-asset v1\.2\.3 task-chrome-plugin-v1\.1\.0\.zip/, '不同名历史 asset 不应被删');
      assert.doesNotMatch(order, /delete-asset v1\.2\.3 task-chrome-plugin-v1\.2\.3\.crx/, '本次新增的 crx 远端不存在，不应删');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('无同名旧 asset 时不删除，直接上传', () => {
    const { dir, bin, log } = makeEnv();
    try {
      const result = run(dir, bin, log, [
        '--repo', 'o/r',
        '--tag', 'v1.2.3',
        '--asset', path.join(dir, 'task-chrome-plugin-v1.2.3.zip'),
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(ok(result.calls), /delete-asset/);
      assert.match(ok(result.calls), /release upload v1\.2\.3/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('附件缺失以 exit 1 拒绝，不产生任何 gh 调用', () => {
    const { dir, bin, log } = makeEnv();
    try {
      const result = run(dir, bin, log, [
        '--repo', 'o/r',
        '--tag', 'v1.2.3',
        '--asset', path.join(dir, 'missing.zip'),
      ]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /附件不存在/);
      assert.deepEqual(result.calls, []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('缺少必填参数 / 未知参数 exit 2', () => {
    const { dir, bin, log } = makeEnv();
    try {
      assert.equal(run(dir, bin, log, ['--repo', 'o/r']).status, 2);
      assert.equal(run(dir, bin, log, ['--mirror-everything']).status, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
