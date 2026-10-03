'use strict';

/**
 * 侧栏「本机模型」完整管理：下载/取消须有可见反馈（用户激活修复的 UI 面）。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'sidepanel/builtin-model-panel.js'), 'utf8');

describe('builtin-model-panel download UX', () => {
  it('下载失败写 paBuiltinFailed，不得仅 catch 后 probeDetails', () => {
    assert.match(src, /paBuiltinFailed/);
    assert.equal(
      /catch\s*\(\s*_\s*\)\s*\{\s*await probeDetails\(\);\s*\}/.test(src),
      false,
      '不得静默吞掉下载错误',
    );
  });

  it('取消无进行中下载时回退到 paBuiltinNeedsDownload', () => {
    assert.match(src, /cancelDownload/);
    assert.match(src, /paBuiltinNeedsDownload/);
  });

  it('点击下载后立即显示下载中文案', () => {
    assert.match(src, /paBuiltinDownloading/);
  });

  it('探测用 phaseForSettingsProbe 而不是原样保留 collecting', () => {
    assert.match(src, /phaseForSettingsProbe/);
    assert.match(src, /clearInFlight:\s*true/);
    assert.doesNotMatch(
      src,
      /snap\.phase === 'generating' \|\| snap\.phase === 'collecting'/,
    );
  });

  it('session 变化只刷新设置文案，不重跑 probeDetails', () => {
    assert.match(src, /statusLineForSettings/);
    const listener = src.slice(src.indexOf('chrome.storage.onChanged.addListener'));
    const chunk = listener.slice(0, listener.indexOf('updateTabVisibility'));
    assert.doesNotMatch(chunk, /probeDetails\(/);
  });
});
