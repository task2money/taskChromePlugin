'use strict';

// OPT-20261026-007: ensure_gh_auth 的凭据回退。
// 用 PATH stub 模拟 gh 与 git，不触网、不读写真实凭据。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LIB = path.join(__dirname, '..', 'scripts', 'gh-auth.sh');

function makeStubDir({ ghOkWithToken, credentialPassword }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-auth-test.'));
  const gh = path.join(dir, 'gh');
  // gh api user: 仅当 GH_TOKEN 等于期望值（或期望值为空表示不依赖 token）时成功
  fs.writeFileSync(
    gh,
    `#!/usr/bin/env bash
if [ "\${1:-}" = "api" ] && [ "\${2:-}" = "user" ]; then
  want='${ghOkWithToken || ''}'
  if [ -z "$want" ]; then exit 0; fi
  if [ "\${GH_TOKEN:-}" = "$want" ]; then exit 0; fi
  exit 1
fi
exit 1
`,
    { mode: 0o755 }
  );
  const git = path.join(dir, 'git');
  fs.writeFileSync(
    git,
    `#!/usr/bin/env bash
if [ "\${1:-}" = "credential" ] && [ "\${2:-}" = "fill" ]; then
  cat >/dev/null
  if [ -n '${credentialPassword || ''}' ]; then
    printf 'username=stub\\npassword=%s\\n' '${credentialPassword || ''}'
  else
    exit 1
  fi
  exit 0
fi
exit 1
`,
    { mode: 0o755 }
  );
  return dir;
}

function runAuth(stubDir) {
  const script = `set -u; . "${LIB}"; ensure_gh_auth`;
  const res = spawnSync('bash', ['-c', script], {
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
    encoding: 'utf8',
  });
  return { status: res.status, stderr: res.stderr };
}

test('gh keyring valid: no fallback needed', () => {
  const dir = makeStubDir({ ghOkWithToken: '', credentialPassword: '' });
  const { status } = runAuth(dir);
  assert.strictEqual(status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gh keyring stale: falls back to git credential token', () => {
  const dir = makeStubDir({
    ghOkWithToken: 'keychain-token',
    credentialPassword: 'keychain-token',
  });
  const { status, stderr } = runAuth(dir);
  assert.strictEqual(status, 0);
  assert.match(stderr, /回退到 git credential/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('both sources invalid: actionable error', () => {
  const dir = makeStubDir({ ghOkWithToken: 'never', credentialPassword: '' });
  const { status, stderr } = runAuth(dir);
  assert.strictEqual(status, 1);
  assert.match(stderr, /gh auth login -h github\.com/);
  fs.rmSync(dir, { recursive: true, force: true });
});
