'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { formatRequestAsTaskDescription } = require('../lib/request-task-desc.js');

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
