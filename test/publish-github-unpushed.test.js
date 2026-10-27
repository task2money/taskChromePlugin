'use strict';

/**
 * OPT-20261027-020：post-commit 在 push 之前发布，GitHub 对「目标提交不在
 * 远端」的 Release 返回 `HTTP 422: Release.target_commitish is invalid`。
 * 那种失败与「Release 配置坏了」同形，且每次正常提交都会先踩一次。
 *
 * 脚本必须先问一次 API：提交不在仓库里 → 打印
 * `github=skipped-commit-not-pushed`、`why:` 与 `run: git push ...`，以 3 退出
 * （配置未就绪，和 Gitee 腿的 skipped-mirror-behind 同类），meta 的 SessionEnd
 * 兜底据此保留 pending；提交已在远端 → 继续正常发布。
 *
 * 用 PATH 里的 gh stub 驱动，不访问网络、不触碰真实 Release。
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'publish-github-release.sh');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
const ZIP = path.join(ROOT, 'dist', `task-chrome-plugin-v${VERSION}.zip`);
const SHA = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

let tmp;
let createdZip = false;

/** gh stub：`api user` 成功；`api .../commits/<sha>` 由 commitStatus 决定。 */
function makeGhStub(commitStatus) {
  const file = path.join(tmp, 'gh');
  fs.writeFileSync(file, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${GH_CALLS:?}"
case "$*" in
  "api user") exit 0 ;;
  *"/commits/"*)
    case "${commitStatus}" in
      422) echo "gh: No commit found for SHA (HTTP 422)" >&2; exit 1 ;;
      404) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
    esac
    exit 0
    ;;
  *"releases?per_page"*) echo '[]'; exit 0 ;;
  "release view "*) exit 1 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
  return file;
}

function runScript() {
  const calls = path.join(tmp, 'calls');
  fs.writeFileSync(calls, '');
  // 只放系统目录 + node：开发机上可能有 git 包装脚本（/Users/<user>/bin/git-hook），
  // 它把 `git log -n 10` 里的 -n 当成 --no-verify 拒绝，会让被测脚本的
  // release-highlights 渲染在测试里假失败。测试只关心本脚本的分支。
  const systemPath = [tmp, path.dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin']
    .join(path.delimiter);
  const res = spawnSync('bash', [SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: systemPath,
      GH_CALLS: calls,
      GH_TOKEN: 'stub-token',
      TASK_CHROME_PLUGIN_GH_REPO: 'example/repo',
    },
    encoding: 'utf8',
  });
  return {
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    calls: fs.readFileSync(calls, 'utf8'),
  };
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-gh-unpushed-'));
  if (!fs.existsSync(ZIP)) {
    fs.mkdirSync(path.dirname(ZIP), { recursive: true });
    fs.writeFileSync(ZIP, 'stub zip for publish-github-unpushed.test.js');
    createdZip = true;
  }
});

after(() => {
  if (createdZip) {
    fs.rmSync(ZIP, { force: true });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('publish-github-release 目标提交未推送', () => {
  // GitHub 对未知提交实测返回 422（No commit found for SHA），404 是另一形态。
  for (const httpStatus of ['422', '404']) {
    it(`以 exit 3 跳过并给出 push 指令（HTTP ${httpStatus}），不创建 Release`, () => {
      makeGhStub(httpStatus);
      const res = runScript();

      assert.equal(res.status, 3, `期望 exit 3，实际 ${res.status}\n${res.stderr}`);
      assert.match(res.stderr, /github=skipped-commit-not-pushed/);
      assert.match(res.stderr, /why: commit [0-9a-f]+ is not on example\/repo/);
      assert.match(res.stderr, /run: git push origin/);
      assert.ok(
        res.calls.includes(`api repos/example/repo/commits/${SHA}`),
        `应先查询提交是否存在，实际 gh 调用：\n${res.calls}`,
      );
      assert.ok(!res.calls.includes('release create'), '未推送时不得创建 Release');
    });
  }

  it('API 的其它错误（502）既不能当成「未推送」，也不能继续发布', () => {
    const file = path.join(tmp, 'gh');
    fs.writeFileSync(file, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${GH_CALLS:?}"
case "$*" in
  "api user") exit 0 ;;
  *"/commits/"*) echo "gh: Server Error (HTTP 502)" >&2; exit 1 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
    const res = runScript();

    assert.equal(res.status, 1, `期望 exit 1，实际 ${res.status}\n${res.stderr}`);
    assert.match(res.stderr, /cannot verify/);
    assert.ok(!res.stderr.includes('skipped-commit-not-pushed'));
  });

  it('提交已在远端时继续发布', () => {
    makeGhStub('ok');
    const res = runScript();

    assert.equal(res.status, 0, `期望发布成功，实际 ${res.status}\n${res.stderr}`);
    assert.ok(res.calls.includes(`api repos/example/repo/commits/${SHA}`));
    assert.ok(res.calls.includes('release create'), '已推送时应创建 Release');
    assert.ok(!res.stderr.includes('skipped-commit-not-pushed'));
  });
});
