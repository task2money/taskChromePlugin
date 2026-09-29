'use strict';

/**
 * 悬浮球的 openSidePanel 必须在消息回调的同步栈里调用 sidePanel.open。
 * 先 await i18n 会丢掉用户手势，侧边栏打不开。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('service-worker openSidePanel gesture', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'background', 'service-worker.js'), 'utf8');

  it('openSidePanel 在 whenI18nReady 之前记下打开并调用 sidePanel.open', () => {
    const listener = src.slice(
      src.indexOf('chrome.runtime.onMessage.addListener'),
      src.indexOf('chrome.commands.onCommand'),
    );
    const branch = listener.slice(listener.indexOf("message.action === 'openSidePanel'"));
    const beginAt = branch.indexOf('beginSidePanelOpenFromGesture');
    const i18nAt = branch.indexOf('whenI18nReady()');
    assert.ok(beginAt >= 0 && i18nAt > beginAt);
    assert.match(branch, /finishSidePanelOpenFromGesture/);
  });
});
