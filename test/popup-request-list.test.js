'use strict';

/**
 * OPT-20260831-002: Popup 请求预览复用 RequestListQuery，窄布局排序下拉。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { readPopupBundle } = require('./helpers/popupBundle.js');
const Query = require('../lib/request-list-query.js');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const popupHtml = read('popup/popup.html');
const popupJs = readPopupBundle();

describe('Popup 请求预览复用 RequestListQuery', () => {
  it('popup.html 加载 request-list-query.js 且在 popup.js 之前', () => {
    const queryIdx = popupHtml.indexOf('src="../lib/request-list-query.js"');
    const popupIdx = popupHtml.indexOf('src="popup.js"');
    assert.ok(queryIdx >= 0, '缺少 request-list-query.js');
    assert.ok(popupIdx > queryIdx, 'request-list-query.js 须先于 popup.js');
  });

  it('窄布局有 #reqSort 时间/状态/URL 下拉', () => {
    assert.match(popupHtml, /id="reqSort"/);
    const start = popupHtml.indexOf('id="reqSort"');
    const end = popupHtml.indexOf('</select>', start);
    const block = popupHtml.slice(start, end);
    assert.match(block, /value="timestamp"/);
    assert.match(block, /value="status"/);
    assert.match(block, /value="url"/);
  });

  it('renderRequestList 调用 filterRequests 与 sortRequests，不再手写 filter+capturedAt sort', () => {
    const start = popupJs.indexOf('function renderRequestList');
    assert.ok(start >= 0, '缺少 renderRequestList');
    const end = popupJs.indexOf('function selectRequest', start);
    const fn = popupJs.slice(start, end === -1 ? popupJs.length : end);
    assert.match(fn, /RequestListQuery\.(filterRequests|sortRequests)|Q\.filterRequests/);
    assert.match(fn, /Q\.sortRequests|RequestListQuery\.sortRequests/);
    assert.doesNotMatch(fn, /capturedRequests\.filter\s*\(/);
    assert.doesNotMatch(fn, /filtered\.sort\s*\(/);
  });

  it('绑定 #reqSort change 触发 renderRequestList', () => {
    assert.match(popupJs, /\$\('#reqSort'\)/);
    assert.match(popupJs, /reqSort\.addEventListener\('change',\s*renderRequestList\)/);
  });

  it('默认时间倒序：仅 capturedAt 的弹窗记录新请求在前', () => {
    const list = [
      { id: 'old', capturedAt: 1, url: 'https://a.test/old', method: 'GET', statusCode: 200 },
      { id: 'new', capturedAt: 9, url: 'https://a.test/new', method: 'GET', statusCode: 500 },
    ];
    const filtered = Query.filterRequests(list, { search: '', status: '' });
    const sorted = Query.sortRequests(filtered, { key: 'timestamp', dir: 'desc' });
    assert.deepEqual(sorted.map((r) => r.id), ['new', 'old']);
  });

  it('状态过滤 5xx 后仍按时间倒序', () => {
    const list = [
      { id: 'ok', capturedAt: 8, url: '/ok', method: 'GET', statusCode: 200 },
      { id: 'err-old', capturedAt: 2, url: '/e1', method: 'GET', statusCode: 500 },
      { id: 'err-new', capturedAt: 7, url: '/e2', method: 'POST', statusCode: 503 },
    ];
    const filtered = Query.filterRequests(list, { status: '5xx' });
    const sorted = Query.sortRequests(filtered, { key: 'timestamp', dir: 'desc' });
    assert.deepEqual(sorted.map((r) => r.id), ['err-new', 'err-old']);
  });
});
