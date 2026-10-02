'use strict';

/**
 * Manifest permissions 允许列表回归（权限瘦身 2026-09-16；ADR-0130 恢复 alarms）。
 *
 * 禁止回潮：cookies / activeTab / debugger / scripting / history。
 * alarms：仅用于本机模型出售出站隧道保活（ADR-0130），不得另作滥用。
 * 设计：docs/superpowers/specs/2026-09-16-task-chrome-plugin-manifest-permission-cleanup-design.md
 *      docs/adr/0130-builtin-edge-project-outbound-tunnel.md
 */

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const MANIFEST_PATH = path.join(__dirname, '..', 'manifest.json');

const REQUIRED_PERMISSIONS = [
  'storage',
  'alarms',
  'webRequest',
  'tabs',
  'webNavigation',
  'sidePanel',
  // Beta 新版本 zip 下载完成后打开 chrome://extensions/ 依赖 downloads.onChanged
  'downloads',
];

const FORBIDDEN_PERMISSIONS = [
  'cookies',
  'activeTab',
  'debugger',
  'scripting',
  'history',
];

describe('manifest.json permissions allowlist', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  it('permissions equals required set (no extras, no missing)', () => {
    const perms = [...(manifest.permissions || [])].sort();
    const expected = [...REQUIRED_PERMISSIONS].sort();
    assert.deepEqual(
      perms,
      expected,
      `permissions must be exactly ${expected.join(',')}; got ${perms.join(',')}`,
    );
  });

  it('does not declare forbidden sensitive permissions', () => {
    const perms = new Set(manifest.permissions || []);
    for (const name of FORBIDDEN_PERMISSIONS) {
      assert.equal(perms.has(name), false, `forbidden permission still present: ${name}`);
    }
  });

  it('keeps host_permissions <all_urls> (product: capture any site)', () => {
    assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
  });
});
