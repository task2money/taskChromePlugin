'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function packPaths() {
  const packScript = fs.readFileSync(path.join(ROOT, 'scripts/pack-crx.sh'), 'utf8');
  const block = packScript.match(/PACK_PATHS=\(([\s\S]*?)\)/);
  assert.ok(block, 'pack-crx.sh 中未找到 PACK_PATHS=(...) 清单');
  return block[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

describe('pack-crx side panel', () => {
  it('打包清单包含 side_panel 页面，否则 Chrome 报 Side panel file path must exist', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const rel = manifest.side_panel && manifest.side_panel.default_path;
    assert.equal(typeof rel, 'string');
    assert.ok(rel.length > 0);
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `仓库缺少 ${rel}`);
    const top = rel.split('/')[0];
    assert.ok(
      packPaths().includes(top),
      `PACK_PATHS 缺少 ${top}，zip 解压后加载会报 Side panel file path must exist`,
    );
    const pack = fs.readFileSync(path.join(ROOT, 'scripts/pack-crx.sh'), 'utf8');
    assert.match(pack, /side_panel\.default_path/);
  });
});
