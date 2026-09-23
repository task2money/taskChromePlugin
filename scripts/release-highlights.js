'use strict';

/**
 * 按「上一版 tag → 本版提交」生成 GitHub Release 的「本版要点」。
 * 发布脚本不得再内嵌固定历史条目。
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_HIGHLIGHTS = 12;
const NOISE = [
  /^chore\(auto-commit\)/i,
  /^Merge (branch|pull request|remote-tracking)/i,
];

function parseSemver(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(String(tag || ''));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareParts(left, right) {
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

function pickPreviousRelease(currentTag, releases) {
  const current = parseSemver(currentTag);
  if (!current) return null;
  let best = null;
  let bestParts = null;
  for (const rel of releases || []) {
    const parts = parseSemver(rel && rel.tag);
    if (!parts || compareParts(parts, current) >= 0) continue;
    if (!best || compareParts(parts, bestParts) > 0) {
      best = rel;
      bestParts = parts;
    }
  }
  return best;
}

function formatHighlights(subjects, options) {
  const seen = new Set();
  const kept = [];
  for (const raw of subjects || []) {
    const line = String(raw).replace(/\s+/g, ' ').trim();
    if (!line || NOISE.some((re) => re.test(line))) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    kept.push(line.replace(/^-\s+/, ''));
  }
  if (kept.length === 0) {
    if (options && options.sameCommit) {
      return '- （本版与上一发布指向同一提交，没有新增说明）';
    }
    if (options && options.unresolved) {
      return '- （未能解析上一版提交，未生成本版变更列表）';
    }
    return '- （相对上一版没有新的提交说明）';
  }
  const shown = kept.slice(0, MAX_HIGHLIGHTS);
  const lines = shown.map((subject) => `- ${subject}`);
  const rest = kept.length - shown.length;
  if (rest > 0) lines.push(`- …另有 ${rest} 条提交未列入`);
  return lines.join('\n');
}

function buildReleaseNotes({ version, highlights, hasCrx, compareUrl }) {
  const ver = String(version || '').replace(/^v/, '');
  const tag = `v${ver}`;
  const compare = compareUrl ? `\n\n完整差异：${compareUrl}` : '';
  const crxExtra = hasCrx
    ? `\n| \`task-chrome-plugin-v${ver}.crx\` | Chrome 扩展安装包 |`
    : `\n\n> 本版本未附带 \`.crx\`（缺少 ChromeExtPos 私钥时仅发布 zip）。`;
  return `## 云端Coding: 自动创新助手 ${tag}

Chrome 扩展编译产物。

### 本版要点

${highlights}${compare}

### 安装方式

**方式一（推荐，解压加载）**
1. 下载 \`task-chrome-plugin-v${ver}.zip\` 并解压
2. 打开 Chrome → \`chrome://extensions/\`
3. 启用「开发者模式」
4. 点击「加载已解压的扩展程序」，选择解压后的目录

**方式二（CRX）**
1. 下载 \`task-chrome-plugin-v${ver}.crx\`（若本版提供）
2. 打开 \`chrome://extensions/\`，启用开发者模式后拖入安装

### 资源

| 文件 | 说明 |
|------|------|
| \`task-chrome-plugin-v${ver}.zip\` | 解压后可直接「加载已解压的扩展程序」 |${crxExtra}
`;
}

function notesNeedRefresh(body) {
  const text = String(body || '');
  if (text.includes('自动运行门禁双读')) return true;
  if (text.includes('commit 后自动 pack + GitHub Release（ADR-0097')) return true;
  if (!text.includes('### 本版要点')) return true;
  return false;
}

function collectSubjects({ cwd, fromSha, toRev, limit }) {
  const args = ['-C', cwd, 'log', '--no-merges', '--pretty=%s'];
  if (fromSha) args.push(`${fromSha}..${toRev}`);
  else args.push('-n', String(limit || 10), toRev || 'HEAD');
  const out = execFileSync('git', args, { encoding: 'utf8' });
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

function assertRepo(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repo || ''))) {
    throw new Error(`invalid repo: ${repo}`);
  }
}

function commitExists(cwd, sha) {
  if (!/^[0-9a-f]{40}$/i.test(String(sha || ''))) return false;
  try {
    execFileSync('git', ['-C', cwd, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function loadReleases(repo) {
  assertRepo(repo);
  const list = [];
  for (let page = 1; page <= 20; page += 1) {
    const raw = execFileSync('gh', [
      'api',
      `repos/${repo}/releases?per_page=100&page=${page}`,
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const batch = JSON.parse(raw);
    if (!Array.isArray(batch) || batch.length === 0) break;
    list.push(...batch);
    if (batch.length < 100) break;
  }
  return list.map((rel) => ({
    tag: rel.tag_name,
    sha: rel.target_commitish,
    body: rel.body || '',
    hasCrx: Array.isArray(rel.assets) && rel.assets.some((asset) => String(asset.name || '').endsWith('.crx')),
  }));
}

function resolveSha(cwd, tag, sha) {
  if (commitExists(cwd, sha)) return sha;
  if (!tag) return '';
  try {
    const parsed = execFileSync(
      'git',
      ['-C', cwd, 'rev-parse', '--verify', `${tag}^{commit}`],
      { encoding: 'utf8' },
    ).trim();
    if (commitExists(cwd, parsed)) return parsed;
  } catch {
    return '';
  }
  return '';
}

/**
 * 当前提交是否与上一发布指向同一提交。
 * 同提交再发版只会得到一个「没有新增说明」的空版本，Releases 列表里读者无法据此判断是否有新包。
 * @param {Array<{tag: string, sha: string}>} releases
 * @param {{ cwd: string, tag: string, rev?: string }} options
 * @returns {{ same: boolean, prevTag: string }}
 */
function sameCommitRelease(releases, options) {
  const prev = pickPreviousRelease(options.tag, releases);
  if (!prev) return { same: false, prevTag: '' };
  const prevSha = resolveSha(options.cwd, prev.tag, prev.sha);
  const head = resolveSha(options.cwd, '', options.rev || 'HEAD');
  if (!prevSha || !head) return { same: false, prevTag: prev.tag };
  return { same: prevSha === head, prevTag: prev.tag };
}

function sameCommitAsPreviousRelease({ repo, tag, rev, cwd }) {
  return sameCommitRelease(loadReleases(repo), { cwd, tag, rev });
}

function compareUrlFor(repo, prevTag, tag) {
  if (!repo || !prevTag || !tag) return '';
  return `https://github.com/${repo}/compare/${prevTag}...${tag}`;
}

function highlightsFor(cwd, releases, rel) {
  const head = resolveSha(cwd, rel.tag, rel.sha);
  const prev = pickPreviousRelease(rel.tag, releases);
  const prevSha = prev ? resolveSha(cwd, prev.tag, prev.sha) : '';
  if (head && prevSha && head === prevSha) {
    return formatHighlights([], { sameCommit: true });
  }
  if (head && prevSha) {
    return formatHighlights(collectSubjects({ cwd, fromSha: prevSha, toRev: head }));
  }
  if (head && !prev) {
    return formatHighlights(collectSubjects({ cwd, fromSha: '', toRev: head, limit: 10 }));
  }
  return formatHighlights([], { unresolved: true });
}

function renderFromGit({ repo, tag, rev, hasCrx, cwd }) {
  if (!parseSemver(tag)) throw new Error(`invalid tag: ${tag}`);
  const releases = loadReleases(repo);
  const prev = pickPreviousRelease(tag, releases);
  const prevSha = prev ? resolveSha(cwd, prev.tag, prev.sha) : '';
  const head = resolveSha(cwd, '', rev || 'HEAD');
  let highlights;
  if (prevSha && head && prevSha === head) {
    highlights = formatHighlights([], { sameCommit: true });
  } else if (prevSha) {
    highlights = formatHighlights(collectSubjects({ cwd, fromSha: prevSha, toRev: head || rev || 'HEAD' }));
  } else if (!prev) {
    highlights = formatHighlights(collectSubjects({ cwd, fromSha: '', toRev: rev || 'HEAD', limit: 10 }));
  } else {
    highlights = formatHighlights([], { unresolved: true });
  }
    const notes = buildReleaseNotes({
      version: tag.replace(/^v/, ''),
      highlights,
      hasCrx: Boolean(hasCrx),
      compareUrl: compareUrlFor(repo, prev && prev.tag, tag),
    });
  process.stderr.write(`release-highlights: tag=${tag} prev=${prev ? prev.tag : '(none)'}\n`);
  return notes;
}

function backfill({ repo, cwd, apply, tag }) {
  const releases = loadReleases(repo);
  let updated = 0;
  let skipped = 0;
  for (const rel of releases) {
    if (tag && rel.tag !== tag) continue;
    if (!notesNeedRefresh(rel.body)) {
      skipped += 1;
      process.stderr.write(`release-highlights: keep ${rel.tag}\n`);
      continue;
    }
    const prev = pickPreviousRelease(rel.tag, releases);
    const notes = buildReleaseNotes({
      version: String(rel.tag || '').replace(/^v/, ''),
      highlights: highlightsFor(cwd, releases, rel),
      hasCrx: rel.hasCrx,
      compareUrl: compareUrlFor(repo, prev && prev.tag, rel.tag),
    });
    if (!apply) {
      process.stdout.write(`--- ${rel.tag} ---\n${notes}\n`);
      continue;
    }
    const file = path.join(os.tmpdir(), `task-chrome-plugin-notes-${rel.tag}.md`);
    fs.writeFileSync(file, notes);
    try {
      execFileSync('gh', ['release', 'edit', rel.tag, '-R', repo, '--notes-file', file], { stdio: 'inherit' });
      updated += 1;
      process.stderr.write(`release-highlights: updated ${rel.tag}\n`);
    } catch (err) {
      process.stderr.write(`release-highlights: FAIL ${rel.tag} ${err && err.message ? err.message : err}\n`);
    } finally {
      fs.unlinkSync(file);
    }
  }
  process.stderr.write(`release-highlights: backfill updated=${updated} skipped=${skipped}\n`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
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

function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0] || 'render';
  const cwd = args.cwd || path.resolve(__dirname, '..');
  if (cmd === 'render') {
    const notes = renderFromGit({
      repo: args.repo,
      tag: args.tag,
      rev: args.rev || 'HEAD',
      hasCrx: args.crx === '1' || args.crx === 'true',
      cwd,
    });
    process.stdout.write(notes.endsWith('\n') ? notes : `${notes}\n`);
    return;
  }
  if (cmd === 'guard-same-commit') {
    if (!parseSemver(args.tag)) throw new Error(`invalid tag: ${args.tag}`);
    assertRepo(args.repo);
    let result;
    try {
      result = sameCommitAsPreviousRelease({
        repo: args.repo,
        tag: args.tag,
        rev: args.rev || 'HEAD',
        cwd,
      });
    } catch (err) {
      // 查不到上一版（gh 不可用/网络失败）时不阻断发版：后续 gh release create 会自行报错
      process.stderr.write(`release-highlights: WARN 同提交检查跳过：${err && err.message ? err.message : err}\n`);
      return;
    }
    if (result.same) {
      process.stderr.write(
        `release-highlights: ERROR ${args.tag} 与上一发布 ${result.prevTag} 指向同一提交；`
        + '先提交新变更并升 manifest.json 版本，再发布新的 Release\n',
      );
      process.exit(3);
    }
    process.stderr.write(`release-highlights: same-commit guard ok (prev=${result.prevTag || '(none)'})\n`);
    return;
  }
  if (cmd === 'backfill') {
    backfill({
      repo: args.repo,
      cwd,
      apply: args.apply === true || args.apply === '1',
      tag: typeof args.tag === 'string' ? args.tag : '',
    });
    return;
  }
  throw new Error(`unknown command ${cmd}`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`release-highlights: ERROR ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

module.exports = {
  parseSemver,
  pickPreviousRelease,
  formatHighlights,
  buildReleaseNotes,
  notesNeedRefresh,
  collectSubjects,
  resolveSha,
  sameCommitRelease,
};
