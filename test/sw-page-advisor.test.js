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

  it('polls beyond typical LLM latency and always notifies timeout with non-empty traceId', () => {
    assert.match(src, /PAGE_ADVISOR_POLL_MAX_MS\s*=\s*75000/);
    assert.match(src, /seedTraceId:\s*createTraceId/);
    assert.match(src, /生成优化建议超时（\$\{PAGE_ADVISOR_POLL_MAX_SEC\} 秒），请重试/);
    assert.match(src, /PAGE_ADVISOR_TIMEOUT/);
    assert.match(src, /timeoutTraceId/);
    // Must not regress to the 15s false-timeout window that races real LLM (~17–27s).
    assert.doesNotMatch(src, /PAGE_ADVISOR_POLL_MAX_MS\s*=\s*15000/);
    assert.doesNotMatch(src, /生成优化建议超时（15 秒）/);
  });
});

describe('sw-page-advisor LLM failed / expired traceId', () => {
  const swPath = path.join(__dirname, '../background/sw-page-advisor.js');
  const src = fs.readFileSync(swPath, 'utf8');

  it('failed|expired notify uses resolvePageAdvisorFailTraceId (not bare job.trace_id only)', () => {
    // LLM 402 Insufficient Balance surfaces as job status=failed + error_message;
    // constraint 24 requires data-traceId — must fall back to createTraceId / mint.
    assert.match(src, /function resolvePageAdvisorFailTraceId\s*\(/);
    assert.match(src, /resolvePageAdvisorFailTraceId\s*\(\s*job\s*,\s*createTraceId\s*\)/);
    assert.match(src, /pickJobTraceId/);
    // Forbid the regression that dropped createTraceId on the failed path.
    assert.doesNotMatch(
      src,
      /status === 'failed'[\s\S]{0,400}traceId:\s*job\?\.trace_id\s*\|\|\s*''/,
    );
  });
});
