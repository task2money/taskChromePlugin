'use strict';

/**
 * Popup/侧栏设置内嵌：内置模型基础管理取消下载反馈。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'popup/popup-builtin-mgmt.js'), 'utf8');

describe('popup-builtin-mgmt download UX', () => {
  it('下载失败展示 paBuiltinFailed', () => {
    assert.match(src, /paBuiltinFailed/);
  });

  it('取消无 abort 目标时回退到 paBuiltinNeedsDownload', () => {
    assert.match(src, /cancelDownload/);
    assert.match(src, /paBuiltinNeedsDownload/);
  });

  it('刷新须 clearInFlight，不得把 collecting 写回 session', () => {
    assert.match(src, /clearInFlight:\s*true/);
    assert.match(src, /phaseForSettingsProbe/);
    assert.doesNotMatch(
      src,
      /runtimeSnap\.phase === 'collecting'[\s\S]{0,80}\? runtimeSnap\.phase/,
    );
  });

  it('点击下载后、await create 前立刻写下载中文案', () => {
    const downloadFn = src.slice(src.indexOf('function onDownloadBuiltinModel'));
    const createCall = downloadFn.indexOf('startDownload');
    const immediate = downloadFn.slice(0, createCall);
    assert.match(immediate, /paBuiltinDownloading/);
  });

  it('session 监听不得再 refreshBuiltinRoute 把采集态写回', () => {
    const watchFn = src.slice(src.indexOf('function watchBuiltinRuntime'));
    assert.match(watchFn, /applyBuiltinStatusFromProbe/);
    assert.doesNotMatch(watchFn, /refreshBuiltinRoute\(/);
  });

  it('设置行用 statusLineForSettings，不展示采集中', () => {
    assert.match(src, /statusLineForSettings/);
  });
});
