'use strict';

/**
 * Regression: Alt+E SW timeout path must forward traceId (constraint 24).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('sw-page-advisor timeout traceId', () => {
  const swPath = path.join(__dirname, '../background/sw-page-advisor.js');
  const src = fs.readFileSync(swPath, 'utf8');

  it('polls with seedTraceId and notifies timeout with traceId', () => {
    assert.match(src, /seedTraceId:\s*createTraceId/);
    assert.match(src, /生成优化建议超时（15 秒），请重试/);
    assert.match(src, /traceId:\s*e\?\.traceId\s*\|\|\s*createTraceId/);
    assert.match(src, /PAGE_ADVISOR_TIMEOUT/);
  });
});
