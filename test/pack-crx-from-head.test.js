'use strict';

/**
 * 打包只取已提交树（OPT-20261012-005）。
 *
 * post-commit 调 publish-dist-zip.sh 时工作区常有别的未提交改动；旧版 pack-crx.sh
 * 从工作区 cp，于是把 1.8.237 的未提交样式打进了指向 1.8.236 提交的 Release，
 * 下载用户拿到作者本人都没提交的代码。这里在临时仓里驱动真实脚本，锁定：
 *   1. 工作区脏时 zip 内 manifest 版本仍等于 HEAD；
 *   2. 未提交的新文件不进包；
 *   3. 脏工作区给出明确告警（而不是静默）。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'pack-crx.sh');

const PACK_DIRS = ['_locales', 'background', 'content', 'devtools', 'icons', 'lib', 'panel', 'popup', 'sidepanel'];

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

function writeManifest(dir, version) {
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    `${JSON.stringify({ manifest_version: 3, version, side_panel: { default_path: 'panel/panel.html' } }, null, 2)}\n`,
  );
}

/** 一个满足 PACK_PATHS + _locales 约束的最小插件仓，脚本也拷进去以便按仓运行。 */
function makePluginRepo(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-pack-head-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'pack-crx.sh'));
  for (const d of PACK_DIRS) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.writeFileSync(path.join(dir, d, 'keep.txt'), `${d}\n`);
  }
  fs.writeFileSync(path.join(dir, 'oauth-callback.html'), '<!doctype html>\n');
  fs.writeFileSync(path.join(dir, 'panel', 'panel.html'), '<!doctype html>\n');
  fs.mkdirSync(path.join(dir, '_locales', 'zh_CN'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_locales', 'zh_CN', 'messages.json'), '{}\n');
  writeManifest(dir, version);
  git(dir, ['init', '-b', 'main']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'chore: base']);
  return dir;
}

function zipVersion(dir, zipName) {
  const out = execFileSync('unzip', ['-p', path.join(dir, 'dist', zipName), 'manifest.json'], { encoding: 'utf8' });
  return JSON.parse(out).version;
}

function runPack(dir) {
  const result = spawnSync('bash', [path.join(dir, 'scripts', 'pack-crx.sh'), 'zip'], {
    cwd: dir,
    encoding: 'utf8',
    env: gitEnv(),
  });
  return { status: result.status, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}

describe('pack-crx.sh 只打已提交树', () => {
  it('工作区脏时 zip 版本仍等于 HEAD，且未提交文件不进包', () => {
    const dir = makePluginRepo('9.9.9');
    try {
      // 工作区：manifest 改到 9.9.8（未提交）+ 新增一个未提交文件
      writeManifest(dir, '9.9.8');
      fs.writeFileSync(path.join(dir, 'lib', 'uncommitted-marker.js'), 'never shipped\n');

      const result = runPack(dir);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /未提交改动/, '脏工作区应有明确告警');

      assert.equal(zipVersion(dir, 'task-chrome-plugin-v9.9.9.zip'), '9.9.9');
      assert.equal(
        fs.existsSync(path.join(dir, 'dist', 'task-chrome-plugin-v9.9.8.zip')),
        false,
        '不得按工作区版本产出',
      );
      const listing = execFileSync(
        'unzip',
        ['-Z1', path.join(dir, 'dist', 'task-chrome-plugin-v9.9.9.zip')],
        { encoding: 'utf8' },
      );
      assert.equal(listing.includes('uncommitted-marker.js'), false, '未提交文件不得进包');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('工作区干净时不告警，版本与 HEAD 一致', () => {
    const dir = makePluginRepo('9.9.9');
    try {
      const result = runPack(dir);
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stderr, /未提交改动/);
      assert.equal(zipVersion(dir, 'task-chrome-plugin-v9.9.9.zip'), '9.9.9');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
