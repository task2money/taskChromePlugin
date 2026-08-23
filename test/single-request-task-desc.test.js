'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { formatRequestAsTaskDescription } = require('../lib/request-task-desc.js');

function loadSingleRequestPanel() {
  const fields = {};
  const P = {
    state: { recentRequests: [], selectedRequest: null },
    $(sel) {
      if (!fields[sel]) fields[sel] = { value: '', addEventListener() {} };
      return fields[sel];
    },
    $$() {
      return [];
    },
    formatRequestStatusLabel(req) {
      return String(req.statusCode ?? '');
    },
    isRequestCanceled(req) {
      return !!req.canceled;
    },
    loadWorkspaces() {},
  };
  const ctx = {
    window: { PanelApp: P },
    formatRequestAsTaskDescription,
    URL,
    Date,
    console,
    document: { querySelector() { return null; } },
  };
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, '../panel/tabs/single-request.js'), 'utf8');
  vm.runInContext(src, ctx, { filename: 'single-request.js' });
  return { P, fields };
}

describe('formatRequestAsTaskDescription', () => {
  const base = {
    method: 'POST',
    url: 'https://api.example.com/orders',
    statusText: 'Created',
    time: 42,
    requestHeaders: { 'Content-Type': 'application/json' },
    responseHeaders: { 'Content-Type': 'application/json' },
    responseBody: '{"id":9}',
  };

  it('writes request body into the task description when present', () => {
    const d = formatRequestAsTaskDescription(
      { ...base, requestBody: '{"sku":"a","qty":2}' },
      { statusLabel: '201', canceled: false },
    );
    assert.match(d, /\*\*请求体\*\*/);
    assert.match(d, /\{"sku":"a","qty":2\}/);
    assert.match(d, /\*\*响应体\*\*/);
    assert.match(d, /\*\*请求头\*\*/);
  });

  it('omits the request-body section when body is empty', () => {
    const d = formatRequestAsTaskDescription(
      { ...base, requestBody: '' },
      { statusLabel: '201', canceled: false },
    );
    assert.doesNotMatch(d, /\*\*请求体\*\*/);
  });

  it('includes cancel error when canceled', () => {
    const d = formatRequestAsTaskDescription(
      { ...base, method: 'GET', error: 'net::ERR_ABORTED', requestBody: '' },
      { statusLabel: 'Canceled', canceled: true },
    );
    assert.match(d, /\*\*错误\*\*: net::ERR_ABORTED/);
  });
});

describe('fillRequestDetail click path', () => {
  it('writes request body into #singleTaskDesc when a request is selected', () => {
    const { P, fields } = loadSingleRequestPanel();
    assert.equal(typeof P.fillRequestDetail, 'function');
    P.fillRequestDetail({
      id: 'r1',
      method: 'POST',
      url: 'https://api.example.com/orders',
      statusCode: 201,
      statusText: 'Created',
      time: 42,
      requestBody: '{"sku":"a","qty":2}',
      requestHeaders: { 'Content-Type': 'application/json' },
      responseHeaders: {},
      responseBody: '',
    });
    const desc = fields['#singleTaskDesc'].value;
    assert.match(desc, /\*\*请求体\*\*/);
    assert.match(desc, /\{"sku":"a","qty":2\}/);
  });
});
