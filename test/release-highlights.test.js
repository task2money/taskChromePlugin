'use strict';

/**
 * GitHub Release「本版要点」必须来自上一版以来的提交说明，
 * 不能每次都写成同一段历史文案。
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const {
  pickPreviousRelease,
  formatHighlights,
  buildReleaseNotes,
  notesNeedRefresh,
  collectSubjects,
  resolveSha,
} = require('../scripts/release-highlights.js');

function git(dir, args) {
  return execFileSync(
    'git',
    [
      '-C', dir,
      '-c', 'user.email=release-highlights@example.com',
      '-c', 'user.name=release-highlights',
      '-c', 'commit.gpgsign=false',
      ...args,
    ],
    { encoding: 'utf8' },
  );
}

describe('pickPreviousRelease', () => {
  const releases = [
    { tag: 'v1.8.100', sha: 'a' },
    { tag: 'v1.8.89', sha: 'b' },
    { tag: 'v1.8.9', sha: 'c' },
    { tag: 'v1.9.0', sha: 'd' },
    { tag: 'not-a-version', sha: 'e' },
  ];

  it('按数字版本取严格小于当前 tag 的最近一版', () => {
    assert.deepEqual(pickPreviousRelease('v1.8.90', releases), { tag: 'v1.8.89', sha: 'b' });
  });

  it('没有更旧版本时返回 null', () => {
    assert.equal(pickPreviousRelease('v0.0.1', releases), null);
  });
});

describe('formatHighlights', () => {
  it('去掉自动提交与重复标题，保留当次提交说明', () => {
    const md = formatHighlights([
      'chore(auto-commit): 会话结束自动提交检查点',
      'feat: 插件 1.8.90 未登录时登录表单默认收起',
      'feat: 插件 1.8.90 未登录时登录表单默认收起',
      'fix(popup): 保存路径用会话推 PUT',
    ]);
    assert.match(md, /未登录时登录表单默认收起/);
    assert.match(md, /保存路径用会话推 PUT/);
    assert.doesNotMatch(md, /auto-commit/);
    assert.equal(md.split('\n').filter((line) => line.includes('未登录')).length, 1);
  });

  it('不同提交生成不同要点，且不内置历史固定条目', () => {
    const a = formatHighlights(['feat: 选完类别直接选技能']);
    const b = formatHighlights(['feat: 未登录时登录表单默认收起']);
    assert.notEqual(a, b);
    assert.doesNotMatch(a, /自动运行门禁双读/);
    assert.doesNotMatch(a, /commit 后自动 pack/);
    assert.doesNotMatch(b, /自动运行门禁双读/);
  });

  it('与上一发布同一提交时说明没有新增', () => {
    const md = formatHighlights([], { sameCommit: true });
    assert.match(md, /同一提交/);
    assert.doesNotMatch(md, /自动运行门禁双读/);
  });

  it('区间为空时说明没有新提交，而不是回退到旧文案', () => {
    const md = formatHighlights([]);
    assert.match(md, /没有新的提交说明/);
    assert.doesNotMatch(md, /自动运行门禁双读/);
  });

  it('超过上限时截断并注明条数', () => {
    const subjects = Array.from({ length: 15 }, (_, i) => `feat: change ${i}`);
    const md = formatHighlights(subjects);
    assert.equal(md.split('\n').length, 13);
    assert.match(md, /另有 3 条提交未列入/);
  });
});

describe('buildReleaseNotes', () => {
  it('把当次要点写进本版要点，安装说明仍带版本号', () => {
    const notes = buildReleaseNotes({
      version: '1.8.90',
      highlights: '- feat: 插件 1.8.90 未登录时登录表单默认收起',
      hasCrx: false,
      compareUrl: 'https://github.com/task2money/taskChromePlugin/compare/v1.8.89...v1.8.90',
    });
    assert.match(notes, /### 本版要点/);
    assert.match(notes, /未登录时登录表单默认收起/);
    assert.match(notes, /task-chrome-plugin-v1\.8\.90\.zip/);
    assert.match(notes, /未附带 `\.crx`/);
    assert.doesNotMatch(notes, /自动运行门禁双读/);
    assert.match(notes, /compare\/v1\.8\.89\.\.\.v1\.8\.90/);
  });

  it('有 crx 时列入资源表', () => {
    const notes = buildReleaseNotes({
      version: '1.8.51',
      highlights: '- feat: 双读门禁',
      hasCrx: true,
    });
    assert.match(notes, /task-chrome-plugin-v1\.8\.51\.crx/);
    assert.doesNotMatch(notes, /未附带 `\.crx`/);
  });
});

describe('notesNeedRefresh', () => {
  it('仍是固定历史要点、或缺少本版要点时需要重写', () => {
    assert.equal(notesNeedRefresh('自动运行门禁双读 allow_auto_run'), true);
    assert.equal(notesNeedRefresh('## v1\n### 安装方式\n'), true);
    assert.equal(notesNeedRefresh('### 本版要点\n\n- feat: 真实变更\n'), false);
  });
});

describe('collectSubjects', () => {
  let dir;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-hl-'));
    execFileSync('git', ['-C', dir, 'init', '-b', 'main'], { encoding: 'utf8' });
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n');
    git(dir, ['add', 'a.txt']);
    git(dir, ['commit', '-m', 'feat: base']);
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('只收集上一版提交之后的说明', () => {
    const base = git(dir, ['rev-parse', 'HEAD']).trim();
    fs.writeFileSync(path.join(dir, 'a.txt'), '2\n');
    git(dir, ['add', 'a.txt']);
    git(dir, ['commit', '-m', 'feat: 未登录时登录表单默认收起']);
    fs.writeFileSync(path.join(dir, 'a.txt'), '3\n');
    git(dir, ['add', 'a.txt']);
    git(dir, ['commit', '-m', 'chore(auto-commit): 会话结束自动提交检查点']);
    git(dir, ['tag', 'v1.0.0', base]);
    assert.equal(resolveSha(dir, 'v1.0.0', 'main'), base);
    const subjects = collectSubjects({ cwd: dir, fromSha: base, toRev: 'HEAD' });
    const md = formatHighlights(subjects);
    assert.match(md, /未登录时登录表单默认收起/);
    assert.doesNotMatch(md, /auto-commit/);
    assert.doesNotMatch(md, /^-\s*feat: base/m);
  });
});

describe('publish-github-release.sh', () => {
  it('发布说明改走 release-highlights.js，不再内嵌固定要点', () => {
    const sh = fs.readFileSync(path.join(ROOT, 'scripts/publish-github-release.sh'), 'utf8');
    assert.match(sh, /release-highlights\.js/);
    assert.doesNotMatch(sh, /自动运行门禁双读/);
    assert.doesNotMatch(sh, /commit 后自动 pack \+ GitHub Release/);
  });
});
