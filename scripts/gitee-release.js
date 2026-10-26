'use strict';

/**
 * 把 dist zip（及可选 crx）发布到 Gitee Release。
 * 令牌只从环境变量 GITEE_ACCESS_TOKEN 读取，禁止写入日志或错误信息。
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  pickPreviousRelease,
  formatHighlights,
  buildReleaseNotes,
  collectSubjects,
  gitExec,
} = require('./release-highlights.js');

const API = 'https://gitee.com/api/v5';

function parseGiteeRemote(url) {
  const text = String(url || '').trim().replace(/\.git$/, '');
  const patterns = [
    /^git@gitee\.com:([^/]+)\/([^/]+)$/,
    /^ssh:\/\/git@gitee\.com\/([^/]+)\/([^/]+)$/,
    /^https?:\/\/(?:[^@/]+@)?gitee\.com\/([^/]+)\/([^/]+)$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return { owner: match[1], repo: match[2] };
  }
  return null;
}

function redact(text, token) {
  const raw = String(text || '');
  if (!token) return raw;
  return raw.split(token).join('[redacted]');
}

function attachmentList(body) {
  const raw = (body && (body.attach_files || body.assets)) || [];
  return raw
    .map((item) => ({
      id: item && (item.id || item.attach_file_id),
      name: item && (item.name || item.filename || item.file_name),
    }))
    .filter((item) => item.name);
}

function localNotes({ cwd, tag, owner, repo, hasCrx, rev }) {
  const names = gitExec(['-C', cwd, 'tag', '--list', 'v*'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const releases = names.map((name) => ({ tag: name, sha: '' }));
  const prev = pickPreviousRelease(tag, releases);
  let highlights;
  if (!prev) {
    highlights = formatHighlights(collectSubjects({ cwd, fromSha: '', toRev: rev, limit: 10 }));
  } else {
    const prevSha = gitExec(['-C', cwd, 'rev-parse', `${prev.tag}^{}`]).trim();
    if (prevSha === rev) highlights = formatHighlights([], { sameCommit: true });
    else highlights = formatHighlights(collectSubjects({ cwd, fromSha: prevSha, toRev: rev }));
  }
  const compareUrl = prev ? `https://gitee.com/${owner}/${repo}/compare/${prev.tag}...${tag}` : '';
  return buildReleaseNotes({
    version: tag.replace(/^v/, ''),
    highlights,
    hasCrx,
    compareUrl,
  });
}

function assertOk(result, action, token) {
  if (result.status >= 200 && result.status < 300 && result.body) return;
  const detail = redact(JSON.stringify(result.body || {}), token);
  throw new Error(`${action} failed: ${result.status} ${detail}`);
}

// Gitee 在 tag 还没有 Release 时返回 HTTP 200，正文为 JSON null，而不是 404。
function isAbsentRelease(result) {
  if (!result || result.status === 404) return true;
  if (result.status < 200 || result.status >= 300) return false;
  const body = result.body;
  if (body == null) return true;
  return typeof body === 'object' && !Array.isArray(body) && !body.id;
}

async function syncRelease(input, request) {
  const { owner, repo, tag, target, notes, files, token } = input;
  if (!token) {
    const err = new Error('missing gitee token');
    err.code = 'MISSING_TOKEN';
    throw err;
  }
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let current = await request({ method: 'GET', path: `${base}/releases/tags/${encodeURIComponent(tag)}`, token });
  let created = false;
  if (isAbsentRelease(current)) {
    current = await request({
      method: 'POST',
      path: `${base}/releases`,
      token,
      form: {
        tag_name: tag,
        name: tag,
        body: notes,
        target_commitish: target,
        prerelease: 'false',
      },
    });
    created = true;
    assertOk(current, 'create release', token);
    if (!current.body.id) throw new Error('create release failed: response missing id');
  } else {
    assertOk(current, 'get release', token);
    const patched = await request({
      method: 'PATCH',
      path: `${base}/releases/${current.body.id}`,
      token,
      form: { name: tag, body: notes, tag_name: tag },
    });
    assertOk(patched, 'update release', token);
    if (patched.body && patched.body.id) current = patched;
  }

  const releaseId = current.body.id;
  let attachments = attachmentList(current.body);
  const listed = await request({
    method: 'GET',
    path: `${base}/releases/${releaseId}/attach_files`,
    token,
  });
  if (listed.status >= 200 && listed.status < 300 && Array.isArray(listed.body)) {
    attachments = attachmentList({ attach_files: listed.body });
  }
  const uploaded = [];
  for (const file of files) {
    const name = path.basename(file.path);
    for (const item of attachments.filter((entry) => entry.name === name && entry.id)) {
      const deleted = await request({
        method: 'DELETE',
        path: `${base}/releases/${releaseId}/attach_files/${item.id}`,
        token,
      });
      if (deleted.status !== 404 && (deleted.status < 200 || deleted.status >= 300)) {
        throw new Error(`delete attachment ${name} failed: ${deleted.status} ${redact(JSON.stringify(deleted.body || {}), token)}`);
      }
    }
    const up = await request({
      method: 'POST',
      path: `${base}/releases/${releaseId}/attach_files`,
      token,
      file,
    });
    assertOk(up, `upload ${name}`, token);
    uploaded.push(name);
    const next = attachmentList(up.body);
    if (next.length) attachments = next;
  }
  return {
    releaseId,
    created,
    uploaded,
    url: `https://gitee.com/${owner}/${repo}/releases/tag/${tag}`,
  };
}

// Gitee 的 v5 API 没有「按名字取单个 tag」的端点（/tags/{name} 与
// /git/refs/... 均 404），只能翻页找。发布脚本用它在尝试 git push 之前
// 确认 tag ref 是否已经指向目标提交：Gitee 创建 Release 时会按
// target_commitish 建 tag，此时再走一遍 git push 只会得到假的「漂移」。
async function tagSha({ owner, repo, tag, token }, request) {
  if (!token) {
    const err = new Error('missing gitee token');
    err.code = 'MISSING_TOKEN';
    throw err;
  }
  const perPage = 100;
  for (let page = 1; page <= 20; page += 1) {
    const res = await request({
      method: 'GET',
      path: `/repos/${owner}/${repo}/tags?per_page=${perPage}&page=${page}`,
      token,
    });
    if (res.status !== 200) throw new Error(`list tags failed: HTTP ${res.status}`);
    const list = Array.isArray(res.body) ? res.body : [];
    const hit = list.find((item) => item && item.name === tag);
    if (hit && hit.commit && hit.commit.sha) return hit.commit.sha;
    if (list.length < perPage) return null;
  }
  return null;
}

// 发布前确认本次提交已在 Gitee 镜像里。镜像落后时，创建 Release 的校验
// 报错与「镜像没同步」无关，排障要反推一大圈（OPT-20261027-001）。
async function commitExists({ owner, repo, sha, token }, request) {
  if (!token) {
    const err = new Error('missing gitee token');
    err.code = 'MISSING_TOKEN';
    throw err;
  }
  const res = await request({
    method: 'GET',
    path: `/repos/${owner}/${repo}/commits/${sha}`,
    token,
  });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`commit lookup failed: HTTP ${res.status}`);
}

async function giteeRequest({ method, path: apiPath, token, form, file }) {
  const url = new URL(`${API}${apiPath}`);
  url.searchParams.set('access_token', token);
  const init = { method };
  if (form) {
    const params = new URLSearchParams();
    params.set('access_token', token);
    for (const [key, value] of Object.entries(form)) params.set(key, value);
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    init.body = params.toString();
  } else if (file) {
    const body = new FormData();
    body.append('access_token', token);
    const bytes = fs.readFileSync(file.path);
    body.append('file', new Blob([bytes]), path.basename(file.path));
    init.body = body;
  }
  const response = await fetch(url, init);
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text.slice(0, 300) };
    }
  }
  return { status: response.status, body: parsed };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

async function publishFromCli(argv, env, request) {
  const args = parseArgs(argv);
  const token = String(env.GITEE_ACCESS_TOKEN || '').trim();
  if (!token) {
    const err = new Error('missing gitee token');
    err.code = 'MISSING_TOKEN';
    throw err;
  }
  const cwd = args.cwd || process.cwd();
  const version = JSON.parse(fs.readFileSync(path.join(cwd, 'manifest.json'), 'utf8')).version;
  const tag = `v${version}`;
  const rev = String(args.rev || gitExec(['-C', cwd, 'rev-parse', 'HEAD'])).trim();
  const files = [{ path: args.zip }];
  const hasCrx = Boolean(args.crx && fs.existsSync(args.crx));
  if (hasCrx) files.push({ path: args.crx });
  for (const file of files) {
    if (!file.path || !fs.existsSync(file.path)) throw new Error(`missing asset ${file.path || ''}`);
  }
  const notes = localNotes({
    cwd,
    tag,
    owner: args.owner,
    repo: args.repo,
    hasCrx,
    rev,
  });
  return syncRelease({
    owner: args.owner,
    repo: args.repo,
    tag,
    target: rev,
    notes,
    files,
    token,
  }, request);
}

async function tagShaFromCli(argv, env, request) {
  const args = parseArgs(argv);
  const sha = await tagSha({
    owner: args.owner,
    repo: args.repo,
    tag: args.tag,
    token: String(env.GITEE_ACCESS_TOKEN || '').trim(),
  }, request);
  process.stdout.write(`${sha || ''}\n`);
}

async function commitExistsFromCli(argv, env, request) {
  const args = parseArgs(argv);
  const exists = await commitExists({
    owner: args.owner,
    repo: args.repo,
    sha: args.sha,
    token: String(env.GITEE_ACCESS_TOKEN || '').trim(),
  }, request);
  process.stdout.write(`${exists ? 'yes' : 'no'}\n`);
}

async function main(argv, env) {
  const cmd = argv[0];
  if (cmd === 'tag-sha') {
    await tagShaFromCli(argv.slice(1), env, giteeRequest);
    return;
  }
  if (cmd === 'commit-exists') {
    await commitExistsFromCli(argv.slice(1), env, giteeRequest);
    return;
  }
  if (cmd !== 'publish') throw new Error(`unknown command ${cmd || ''}`);
  const result = await publishFromCli(argv.slice(1), env, giteeRequest);
  process.stderr.write(`gitee-release: OK ${result.url}\n`);
}

if (require.main === module) {
  main(process.argv.slice(2), process.env).catch((err) => {
    const token = String(process.env.GITEE_ACCESS_TOKEN || '');
    const message = redact(err && err.message ? err.message : String(err), token);
    process.stderr.write(`gitee-release: ERROR ${message}\n`);
    process.exit(err && err.code === 'MISSING_TOKEN' ? 2 : 1);
  });
}

module.exports = {
  parseGiteeRemote,
  redact,
  attachmentList,
  localNotes,
  isAbsentRelease,
  syncRelease,
  tagSha,
  commitExists,
  publishFromCli,
};
