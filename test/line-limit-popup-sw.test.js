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

  it('popup.html 加载的 popup/*.css 均 ≤500 行', () => {
    // OPT-20260927-001：popup.css 曾 527 行，拆出 popup-guide.css；门禁随 html 链接走，
    // 新增样式文件不会被漏掉。
    const html = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
    const links = [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"/g)].map((m) => m[1]);
    const local = links.filter((href) => !href.startsWith('../'));
    assert.ok(local.length >= 1, 'popup.html 缺少本地样式表');
    for (const href of local) {
      const rel = path.join('popup', path.basename(href));
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
