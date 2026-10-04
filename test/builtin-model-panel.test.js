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

  it('解压进度条随 session 刷新，不 probeDetails', () => {
    assert.match(src, /syncSpProgress/);
    assert.match(src, /applyProgressBar/);
  });

  it('进度回调不得 probeDetails，避免 100% 解压时刷成尚未启用', () => {
    const downloadFn = src.slice(src.indexOf('function onDownload()'));
    const progress = downloadFn.slice(
      downloadFn.indexOf('onProgress'),
      downloadFn.indexOf('startDownload') > 0 ? downloadFn.indexOf('await probeDetails') : downloadFn.length,
    );
    const onProgressBlock = downloadFn.match(/onProgress\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(onProgressBlock, 'missing onProgress');
    assert.doesNotMatch(onProgressBlock[0], /probeDetails\(/);
    void progress;
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

  it('首次探测前 hydrate i18n，避免状态行显示 paBuiltinReady 键名', () => {
    assert.match(src, /hydrateFromStorage/);
    assert.match(src, /applyDom\(document\)/);
  });

  it('配额探测使用 resolveLanguageOptions，刷新不得把 phase 写成 idle', () => {
    assert.match(src, /resolveLanguageOptions/);
    assert.match(src, /if \(phase === 'downloading'\) patch\.phase = phase/);
  });
});
