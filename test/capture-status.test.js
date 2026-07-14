'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const CaptureStatus = require('../lib/capture-status.js');

const {
  matchStatusCode,
  DEFAULT_CAPTURE_STATUS_PATTERNS,
  isHttp5xx,
  filterBadgeCountableRequests,
} = CaptureStatus;

describe('DEFAULT_CAPTURE_STATUS_PATTERNS', () => {
  it('includes canceled', () => {
    assert.ok(DEFAULT_CAPTURE_STATUS_PATTERNS.includes('canceled'));
  });
});

describe('isHttp5xx', () => {
  it('returns true only for 500–599', () => {
    assert.equal(isHttp5xx(500), true);
    assert.equal(isHttp5xx(503), true);
    assert.equal(isHttp5xx(599), true);
  });

  it('returns false for non-5xx including 4xx and canceled 0', () => {
    assert.equal(isHttp5xx(200), false);
    assert.equal(isHttp5xx(301), false);
    assert.equal(isHttp5xx(404), false);
    assert.equal(isHttp5xx(499), false);
    assert.equal(isHttp5xx(600), false);
    assert.equal(isHttp5xx(0), false);
  });
});

describe('filterBadgeCountableRequests', () => {
  it('keeps only 5xx and excludes canceled / 4xx / 2xx', () => {
    const input = [
      { statusCode: 503 },
      { statusCode: 404 },
      { statusCode: 200 },
      { statusCode: 0, canceled: true },
      { statusCode: 500, canceled: true },
      { statusCode: 502 },
    ];
    const out = filterBadgeCountableRequests(input);
    assert.deepEqual(out.map((e) => e.statusCode), [503, 502]);
  });

  it('returns empty array for non-array input', () => {
    assert.deepEqual(filterBadgeCountableRequests(null), []);
    assert.deepEqual(filterBadgeCountableRequests(undefined), []);
  });
});

describe('matchStatusCode', () => {
  it('matches canceled when meta.canceled is true', () => {
    assert.equal(matchStatusCode(0, ['canceled'], { canceled: true }), true);
  });

  it('matches status 0 when canceled pattern enabled', () => {
    assert.equal(matchStatusCode(0, ['canceled'], { canceled: false }), true);
  });

  it('does not match status 0 without canceled pattern', () => {
    assert.equal(matchStatusCode(0, ['4xx', '5xx'], { canceled: false }), false);
  });

  it('matches 4xx and 5xx ranges', () => {
    assert.equal(matchStatusCode(404, ['4xx']), true);
    assert.equal(matchStatusCode(503, ['5xx']), true);
    assert.equal(matchStatusCode(404, ['5xx']), false);
  });

  it('matches exact three-digit pattern', () => {
    assert.equal(matchStatusCode(418, ['418']), true);
    assert.equal(matchStatusCode(419, ['418']), false);
  });

  it('does not treat canceled 0 as 2xx', () => {
    assert.equal(matchStatusCode(0, ['2xx'], { canceled: true }), false);
  });
});
