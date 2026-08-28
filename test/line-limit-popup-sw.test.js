'use strict';

/**
 * OPT-20260821-004: popup + service-worker splits must keep each file ≤500 lines.
 */

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { ROOT, popupPageScriptsFromHtml } = require('./helpers/popupBundle.js');
const { swFilesForLineLimit } = require('./helpers/swBundle.js');

function lineCount(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').length - 1;
}

describe('popup / service-worker 行数门禁', () => {
  it('popup.html 中的 popup/*.js 均 ≤500 行，且 popup.js 最后加载', () => {
    const js = popupPageScriptsFromHtml();
    assert.ok(js.length >= 1, 'popup.html 缺少 popup 脚本');
    assert.equal(js[js.length - 1], 'popup/popup.js');
    for (const rel of js) {
      const n = lineCount(rel);
      assert.ok(n <= 500, `${rel} 有 ${n} 行，超过 500`);
    }
  });

  it('service-worker.js 与 importScripts 的本地 sw-*.js 均 ≤500 行', () => {
    const files = swFilesForLineLimit();
    assert.ok(files.includes('background/service-worker.js'));
    for (const rel of files) {
      const n = lineCount(rel);
      assert.ok(n <= 500, `${rel} 有 ${n} 行，超过 500`);
    }
  });
});
