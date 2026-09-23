'use strict';

/**
 * 插件版本号门禁（OPT-20260923-009）：改了运行时路径却不升 manifest.json 版本时，
 * Chrome 与 GitHub Release 都看不到新包。纯文档/纯测试不触发。
 *
 * 直接驱动 .githooks/lib/version_bump_gate.sh，不跑整份 pre-commit（那会拉起 npm test 与 E2E）。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const GATE = path.join(ROOT, '.githooks', 'lib', 'version_bump_gate.sh');

function git(dir, args) {
  return execFileSync(
    'git',
    [
      '-C', dir,
      '-c', 'user.email=version-gate@example.com',
      '-c', 'user.name=version-gate',
      '-c', 'commit.gpgsign=false',
      ...args,
    ],
    { encoding: 'utf8' },
  );
}

/** 在临时仓里 source 门禁脚本并执行 version_bump_gate，返回 { status, stderr } */
function runGate(dir) {
  const script = `source ${JSON.stringify(GATE)}\nversion_bump_gate`;
  try {
    execFileSync('bash', ['-c', script], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stderr: '' };
  } catch (err) {
    return { status: err.status, stderr: String(err.stderr || '') };
  }
}

function makeRepo(version = '1.8.90') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-version-gate-'));
  execFileSync('git', ['-C', dir, 'init', '-b', 'main'], { encoding: 'utf8' });
  fs.mkdirSync(path.join(dir, 'popup'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), `{\n  "manifest_version": 3,\n  "version": "${version}"\n}\n`);
  fs.writeFileSync(path.join(dir, 'popup', 'popup.js'), 'console.log(1);\n');
  fs.writeFileSync(path.join(dir, 'docs', 'guide.md'), '# guide\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'chore: base']);
  return dir;
}

describe('version_bump_gate', () => {
  it('改 popup 但不升 manifest 版本时被拒', () => {
    const dir = makeRepo();
    try {
      fs.writeFileSync(path.join(dir, 'popup', 'popup.js'), 'console.log(2);\n');
      git(dir, ['add', 'popup/popup.js']);
      const result = runGate(dir);
      assert.notEqual(result.status, 0, '必须非 0 退出');
      assert.match(result.stderr, /version 未变/);
      assert.match(result.stderr, /1\.8\.90/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('同时升 manifest 版本时放行', () => {
    const dir = makeRepo();
    try {
      fs.writeFileSync(path.join(dir, 'popup', 'popup.js'), 'console.log(2);\n');
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        '{\n  "manifest_version": 3,\n  "version": "1.8.91"\n}\n',
      );
      git(dir, ['add', 'popup/popup.js', 'manifest.json']);
      assert.equal(runGate(dir).status, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('只改了工作区版本但没 add 时仍被拒（索引里版本没变）', () => {
    const dir = makeRepo();
    try {
      fs.writeFileSync(path.join(dir, 'popup', 'popup.js'), 'console.log(2);\n');
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        '{\n  "manifest_version": 3,\n  "version": "1.8.91"\n}\n',
      );
      git(dir, ['add', 'popup/popup.js']);
      assert.notEqual(runGate(dir).status, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('纯文档、纯测试与 .githooks 改动不触发', () => {
    const dir = makeRepo();
    try {
      fs.writeFileSync(path.join(dir, 'docs', 'guide.md'), '# guide v2\n');
      fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'test', 'x.test.js'), '// t\n');
      fs.mkdirSync(path.join(dir, '.githooks'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.githooks', 'pre-commit'), '# hook\n');
      git(dir, ['add', '-A']);
      assert.equal(runGate(dir).status, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pre-commit 已接入门禁且在抽测之前', () => {
    const hook = fs.readFileSync(path.join(ROOT, '.githooks', 'pre-commit'), 'utf8');
    assert.match(hook, /version_bump_gate/);
    const gateAt = hook.indexOf('version_bump_gate || exit 1');
    const testAt = hook.indexOf('Running pre-commit Node tests');
    assert.ok(gateAt > 0 && testAt > 0 && gateAt < testAt, '门禁必须在抽测之前');
  });
});
