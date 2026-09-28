'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const {
  parseGiteeRemote,
  redact,
  isAbsentRelease,
  syncRelease,
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

describe('localNotes', () => {
  it('比较链接指向 Gitee', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitee-notes-'));
    try {
      const git = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
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

  it('跳过开关生效，且脚本不回显令牌', () => {
    assert.match(sh, /TASK_CHROME_PLUGIN_SKIP_GITEE_RELEASE/);
    assert.match(sh, /overlay_conf_file/);
    assert.doesNotMatch(sh, /echo[^\\n]*GITEE_ACCESS_TOKEN/);
    const out = execFileSync('bash', [path.join(ROOT, 'scripts/publish-gitee-release.sh')], {
      env: { ...process.env, TASK_CHROME_PLUGIN_SKIP_GITEE_RELEASE: '1' },
      encoding: 'utf8',
    });
    assert.equal(out, '');
  });

  it('dist 发布在 GitHub 之后调用 Gitee', () => {
    const dist = fs.readFileSync(path.join(ROOT, 'scripts/publish-dist-zip.sh'), 'utf8');
    const ghAt = dist.indexOf('publish-github-release.sh');
    const giteeAt = dist.indexOf('publish-gitee-release.sh');
    assert.ok(ghAt > 0 && giteeAt > ghAt);
  });
});

describe('redact', () => {
  it('替换令牌原文', () => {
    assert.equal(redact('token=abc', 'abc'), 'token=[redacted]');
  });
});
