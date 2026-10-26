'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
// 本测会在 pre-commit 里跑。父进程的 GIT_INDEX_FILE 等指向插件暂存区，
// 临时仓库的 git 若沿用会去解析并不存在的对象。
const GIT_ENV = (() => {
  const env = { ...process.env };
  for (const key of ['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_PREFIX',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) {
    delete env[key];
  }
  return env;
})();
const {
  parseGiteeRemote,
  redact,
  isAbsentRelease,
  syncRelease,
  tagSha,
  commitExists,
  localNotes,
} = require('../scripts/gitee-release.js');

describe('parseGiteeRemote', () => {
  it('解析 SSH 与 HTTPS 地址', () => {
    assert.deepEqual(
      parseGiteeRemote('git@gitee.com:ljy-ruandao/task-chrome-plugin'),
      { owner: 'ljy-ruandao', repo: 'task-chrome-plugin' },
    );
    assert.deepEqual(
      parseGiteeRemote('https://gitee.com/ljy-ruandao/task-chrome-plugin.git'),
      { owner: 'ljy-ruandao', repo: 'task-chrome-plugin' },
    );
    assert.equal(parseGiteeRemote('git@github.com:task2money/taskChromePlugin'), null);
  });
});

describe('syncRelease', () => {
  const token = 'secret-token-value';
  const zip = { path: '/tmp/task-chrome-plugin-v1.8.112.zip' };

  it('没有 Release 时创建并上传附件，错误信息去掉令牌', async () => {
    const calls = [];
    const request = async (req) => {
      calls.push(req.method + ' ' + req.path);
      if (req.method === 'GET') return { status: 404, body: { message: token } };
      if (req.method === 'POST' && req.path.endsWith('/releases')) {
        assert.equal(req.form.tag_name, 'v1.8.112');
        assert.equal(req.form.target_commitish, 'abc');
        return { status: 201, body: { id: 9, attach_files: [] } };
      }
      if (req.method === 'POST' && req.path.endsWith('/attach_files')) {
        return { status: 201, body: { id: 9, attach_files: [{ id: 3, name: 'task-chrome-plugin-v1.8.112.zip' }] } };
      }
      return { status: 500, body: { message: token } };
    };
    const result = await syncRelease({
      owner: 'ljy-ruandao',
      repo: 'task-chrome-plugin',
      tag: 'v1.8.112',
      target: 'abc',
      notes: 'notes',
      files: [zip],
      token,
    }, request);
    assert.equal(result.created, true);
    assert.deepEqual(result.uploaded, ['task-chrome-plugin-v1.8.112.zip']);
    assert.deepEqual(calls, [
      'GET /repos/ljy-ruandao/task-chrome-plugin/releases/tags/v1.8.112',
      'POST /repos/ljy-ruandao/task-chrome-plugin/releases',
      'GET /repos/ljy-ruandao/task-chrome-plugin/releases/9/attach_files',
      'POST /repos/ljy-ruandao/task-chrome-plugin/releases/9/attach_files',
    ]);
    await assert.rejects(
      () => syncRelease({
        owner: 'ljy-ruandao',
        repo: 'task-chrome-plugin',
        tag: 'v1.8.112',
        target: 'abc',
        notes: 'notes',
        files: [zip],
        token,
      }, async () => ({ status: 422, body: { message: `bad ${token}` } })),
      (err) => !String(err.message).includes(token) && String(err.message).includes('[redacted]'),
    );
  });

  it('查询返回 200 且正文为 null 时仍创建 Release', async () => {
    assert.equal(isAbsentRelease({ status: 200, body: null }), true);
    const calls = [];
    const request = async (req) => {
      calls.push(req.method);
      if (req.method === 'GET') return { status: 200, body: null };
      if (req.method === 'POST' && req.path.endsWith('/releases')) {
        return { status: 201, body: { id: 9, attach_files: [] } };
      }
      return { status: 201, body: { id: 9, attach_files: [{ id: 3, name: 'task-chrome-plugin-v1.8.112.zip' }] } };
    };
    const result = await syncRelease({
      owner: 'ljy-ruandao',
      repo: 'task-chrome-plugin',
      tag: 'v1.8.112',
      target: 'abc',
      notes: 'notes',
      files: [zip],
      token,
    }, request);
    assert.equal(result.created, true);
    assert.deepEqual(calls, ['GET', 'POST', 'GET', 'POST']);
  });

  it('已有同名附件时先删除再上传', async () => {
    const calls = [];
    const request = async (req) => {
      calls.push(req.method + ' ' + req.path);
      if (req.method === 'GET' && req.path.includes('/attach_files')) {
        return { status: 200, body: [{ id: 8, name: 'task-chrome-plugin-v1.8.112.zip' }] };
      }
      if (req.method === 'GET') {
        return { status: 200, body: { id: 4, assets: [{ name: 'task-chrome-plugin-v1.8.112.zip' }] } };
      }
      if (req.method === 'PATCH') return { status: 200, body: { id: 4 } };
      if (req.method === 'DELETE') return { status: 204, body: {} };
      return { status: 201, body: { id: 4, attach_files: [{ id: 11, name: 'task-chrome-plugin-v1.8.112.zip' }] } };
    };
    const result = await syncRelease({
      owner: 'o',
      repo: 'r',
      tag: 'v1.8.112',
      target: 'abc',
      notes: 'n',
      files: [zip],
      token,
    }, request);
    assert.equal(result.created, false);
    assert.ok(calls.some((line) => line.startsWith('DELETE ')));
    assert.ok(calls.some((line) => line.includes('/attach_files') && line.startsWith('GET ')));
  });
});

describe('tagSha', () => {
  const page = (n) => Array.from({ length: n }, (_, i) => ({ name: `v0.0.${i}`, commit: { sha: 'a' } }));

  it('翻页找到 tag 的提交', async () => {
    const pages = [page(100), [{ name: 'v1.8.276', commit: { sha: 'deadbeef' } }]];
    const calls = [];
    const sha = await tagSha({ owner: 'o', repo: 'r', tag: 'v1.8.276', token: 't' }, async (req) => {
      calls.push(req.path);
      const n = Number(new URL(`https://x${req.path}`).searchParams.get('page'));
      return { status: 200, body: pages[n - 1] };
    });
    assert.equal(sha, 'deadbeef');
    assert.equal(calls.length, 2);
    assert.match(calls[0], /^\/repos\/o\/r\/tags\?per_page=100&page=1$/);
  });

  it('没有该 tag 时返回 null', async () => {
    const sha = await tagSha({ owner: 'o', repo: 'r', tag: 'v9.9.9', token: 't' },
      async () => ({ status: 200, body: page(3) }));
    assert.equal(sha, null);
  });

  it('缺令牌时抛 MISSING_TOKEN', async () => {
    await assert.rejects(
      () => tagSha({ owner: 'o', repo: 'r', tag: 'v1', token: '' }, async () => ({ status: 200, body: [] })),
      (err) => err.code === 'MISSING_TOKEN',
    );
  });
});

describe('commitExists', () => {
  it('200 表示已在镜像，404 表示镜像落后', async () => {
    const input = { owner: 'o', repo: 'r', sha: 'abc', token: 't' };
    assert.equal(await commitExists(input, async () => ({ status: 200, body: {} })), true);
    assert.equal(await commitExists(input, async () => ({ status: 404, body: { message: 'not found' } })), false);
  });

  it('其它状态抛出，由调用方决定是否放行', async () => {
    await assert.rejects(
      () => commitExists({ owner: 'o', repo: 'r', sha: 'abc', token: 't' },
        async () => ({ status: 500, body: {} })),
      /commit lookup failed: HTTP 500/,
    );
  });

  it('缺令牌时抛 MISSING_TOKEN', async () => {
    await assert.rejects(
      () => commitExists({ owner: 'o', repo: 'r', sha: 'abc', token: '' }, async () => ({ status: 200 })),
      (err) => err.code === 'MISSING_TOKEN',
    );
  });
});

describe('localNotes', () => {
  it('比较链接指向 Gitee', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitee-notes-'));
    try {
      const git = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: GIT_ENV });
      git(['init', '-b', 'main']);
      git(['config', 'user.email', 't@example.com']);
      git(['config', 'user.name', 't']);
      fs.writeFileSync(path.join(dir, 'a.txt'), '1\n');
      git(['add', 'a.txt']);
      git(['commit', '-m', 'feat: 上一版']);
      git(['tag', 'v1.8.111']);
      fs.writeFileSync(path.join(dir, 'a.txt'), '2\n');
      git(['add', 'a.txt']);
      git(['commit', '-m', 'feat: 本版选择工作空间']);
      const head = git(['rev-parse', 'HEAD']).trim();
      const notes = localNotes({
        cwd: dir,
        tag: 'v1.8.112',
        owner: 'ljy-ruandao',
        repo: 'task-chrome-plugin',
        hasCrx: false,
        rev: head,
      });
      assert.match(notes, /feat: 本版选择工作空间/);
      assert.match(notes, /https:\/\/gitee\.com\/ljy-ruandao\/task-chrome-plugin\/compare\/v1\.8\.111\.\.\.v1\.8\.112/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('publish-gitee-release.sh', () => {
  const sh = fs.readFileSync(path.join(ROOT, 'scripts/publish-gitee-release.sh'), 'utf8');

  // A scratch checkout of just the script (+ the parser it calls), so the
  // remote/token branches run without touching the real repository config.
  function scratchRepo({ remote } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitee-release-'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.copyFileSync(path.join(ROOT, 'scripts/publish-gitee-release.sh'),
      path.join(dir, 'scripts/publish-gitee-release.sh'));
    // gitee-release.js requires these two at load time.
    for (const dep of ['gitee-release.js', 'release-highlights.js']) {
      fs.copyFileSync(path.join(ROOT, 'scripts', dep), path.join(dir, 'scripts', dep));
    }
    // The publish path is faked: no network, no real tag retarget.
    fs.writeFileSync(path.join(dir, 'scripts/retarget-release-tag.sh'), '#!/usr/bin/env bash\nexit 0\n');
    fs.chmodSync(path.join(dir, 'scripts/retarget-release-tag.sh'), 0o755);
    fs.mkdirSync(path.join(dir, 'shim'));
    fs.writeFileSync(path.join(dir, 'shim/node'),
      '#!/bin/sh\ncase "$1" in\n  -e) printf \'ljy-ruandao task-chrome-plugin\' ;;\n'
      + '  -p) printf \'1.8.276\' ;;\n'
      + '  *) case "$2" in\n'
      + '       commit-exists) printf \'%s\' "${SHIM_COMMIT_EXISTS:-yes}" ;;\n'
      + '     esac ;;\n'
      + 'esac\nexit 0\n');
    fs.chmodSync(path.join(dir, 'shim/node'), 0o755);
    execFileSync('git', ['init', '-q', dir], { env: GIT_ENV });
    execFileSync('git', ['-C', dir, '-c', 'user.email=t@example.com', '-c', 'user.name=t',
      'commit', '-q', '--allow-empty', '-m', 'init'], { env: GIT_ENV });
    if (remote) execFileSync('git', ['-C', dir, 'remote', 'add', 'gitee', remote], { env: GIT_ENV });
    return dir;
  }

  function runScript(dir, env = {}) {
    try {
      const out = execFileSync('bash', [path.join(dir, 'scripts/publish-gitee-release.sh')], {
        // GIT_ENV：pre-commit 传下来的 GIT_DIR 会让 scratch 仓里的脚本读到
        // 插件仓的 remote/HEAD，no-remote 用例就永远走不到。
        env: { ...GIT_ENV, GITEE_ACCESS_TOKEN: '', ...env },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, out };
    } catch (err) {
      return { code: err.status, out: String(err.stdout || ''), err: String(err.stderr || '') };
    }
  }

  it('跳过开关生效，且脚本不回显令牌', () => {
    assert.match(sh, /TASK_CHROME_PLUGIN_SKIP_GITEE_RELEASE/);
    assert.match(sh, /overlay_conf_file/);
    assert.doesNotMatch(sh, /echo[^\\n]*GITEE_ACCESS_TOKEN/);
    const out = execFileSync('bash', [path.join(ROOT, 'scripts/publish-gitee-release.sh')], {
      env: { ...process.env, TASK_CHROME_PLUGIN_SKIP_GITEE_RELEASE: '1' },
      encoding: 'utf8',
    });
    assert.equal(out.trim(), 'GITEE_RELEASE_STATUS=skipped-explicit');
  });

  it('没有 gitee remote 时报 SKIPPED 并以 3 退出', () => {
    const dir = scratchRepo();
    const { code, out, err } = runScript(dir);
    assert.equal(code, 3);
    assert.match(err, /SKIPPED: no gitee remote/);
    assert.match(err, /ensure-gitee-mirror\.sh/);
    assert.match(out, /GITEE_RELEASE_STATUS=skipped-no-remote/);
  });

  it('有 remote 但没有令牌时以 3 退出并给出状态', () => {
    const dir = scratchRepo({ remote: 'git@gitee.com:ljy-ruandao/task-chrome-plugin' });
    const { code, out, err } = runScript(dir);
    assert.equal(code, 3);
    assert.match(err, /缺少 Gitee 私人令牌/);
    assert.match(out, /GITEE_RELEASE_STATUS=skipped-no-token/);
  });

  it('没有 .crx 时也能走完发布（bash 3.2 空数组不再 unbound variable）', () => {
    // 自 v1.8.26 起 dist/ 里没有 .crx，CRX 参数数组恒为空。macOS 的
    // /bin/bash 3.2 在 set -u 下展开空数组会直接退出，Gitee 腿曾因此在
    // 调 API 之前就死掉（只留下 "unbound variable"）。
    const dir = scratchRepo({ remote: 'git@gitee.com:ljy-ruandao/task-chrome-plugin' });
    const { code, out, err } = runScript(dir, {
      GITEE_ACCESS_TOKEN: 'token-for-test',
      PATH: `${path.join(dir, 'shim')}:${process.env.PATH}`,
    });
    assert.equal(code, 0, err);
    assert.match(out, /GITEE_RELEASE_STATUS=published/);
  });

  it('镜像缺少本次提交时以 3 退出并给出同步提示', () => {
    const dir = scratchRepo({ remote: 'git@gitee.com:ljy-ruandao/task-chrome-plugin' });
    const { code, out, err } = runScript(dir, {
      GITEE_ACCESS_TOKEN: 'token-for-test',
      PATH: `${path.join(dir, 'shim')}:${process.env.PATH}`,
      SHIM_COMMIT_EXISTS: 'no',
    });
    assert.equal(code, 3, err);
    assert.match(err, /gitee mirror lacks commit/);
    assert.match(err, /--sync-https/);
    assert.match(out, /GITEE_RELEASE_STATUS=skipped-mirror-behind/);
  });

  it('镜像检查通过后才调用发布（检查错误时放行）', () => {
    assert.match(sh, /commit-exists/);
    assert.match(sh, /skipped-mirror-behind/);
    // 检查本身失败（非 "no"）不能阻断发布：只认字符串 no。
    assert.match(sh, /if \[ "\$MIRROR_HAS_COMMIT" = "no" \]/);
  });

  it('空 CRX 参数使用 bash 3.2 安全展开', () => {
    assert.match(sh, /\$\{CRX_ARGS\[@\]\+"\$\{CRX_ARGS\[@\]\}"\}/);
    assert.doesNotMatch(sh, /"\$\{CRX_ARG\[@\]\}"/);
  });

  it('tag 已指向本次提交时不再 push，移动失败只告警', () => {
    // API 说 tag 已就位 → 不再尝试 git push（否则缺推送权限会报假漂移）。
    assert.match(sh, /tag-sha/);
    assert.match(sh, /REMOTE_TAG_SHA/);
    assert.match(sh, /if ! bash "\$ROOT\/scripts\/retarget-release-tag\.sh"/);
    assert.match(sh, /published-tag-drift/);
  });

  it('dist 发布在 GitHub 之后调用 Gitee，并汇总两端状态', () => {
    const dist = fs.readFileSync(path.join(ROOT, 'scripts/publish-dist-zip.sh'), 'utf8');
    const ghAt = dist.indexOf('publish-github-release.sh');
    const giteeAt = dist.indexOf('publish-gitee-release.sh');
    assert.ok(ghAt > 0 && giteeAt > ghAt);
    assert.match(dist, /publish-dist-zip: SUMMARY github=published gitee=\$\{gitee_status\}/);
    assert.match(dist, /exit "\$gitee_rc"/);
  });
});

describe('redact', () => {
  it('替换令牌原文', () => {
    assert.equal(redact('token=abc', 'abc'), 'token=[redacted]');
  });
});
