'use strict';

/**
 * 网页账号桥（taskfe-account-bridge / page-bridge.js）已下线：
 * taskFE 改走 localStorage，页面不再经 postMessage 向插件要 token。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

describe('page-bridge 已删除', () => {
  it('lib/page-bridge.js 不存在', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'lib/page-bridge.js')), false);
  });

  it('manifest 不再注入 page-bridge', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const js = (manifest.content_scripts || []).flatMap((s) => s.js || []);
    assert.ok(!js.includes('lib/page-bridge.js'), 'content_scripts 仍含 page-bridge.js');
  });

  it('content.js 不再向页面 postMessage 账号桥协议', () => {
    const src = fs.readFileSync(path.join(ROOT, 'content/content.js'), 'utf8');
    assert.doesNotMatch(src, /taskfe-account-bridge/);
    assert.doesNotMatch(src, /notifyPageAccountStateChanged/);
    assert.doesNotMatch(src, /shouldNotifyPageAccountStateFromContent/);
  });

  it('hot-path-guards 不再导出 page-bridge 函数', () => {
    const Guards = require('../lib/hot-path-guards.js');
    assert.equal(Guards.shouldInspectPageBridgeMessage, undefined);
    assert.equal(Guards.shouldNotifyPageAccountStateFromContent, undefined);
  });
});
