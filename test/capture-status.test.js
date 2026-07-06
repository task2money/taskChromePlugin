'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const CaptureStatus = require('../lib/capture-status.js');

const { matchStatusCode, DEFAULT_CAPTURE_STATUS_PATTERNS } = CaptureStatus;

describe('DEFAULT_CAPTURE_STATUS_PATTERNS', () => {
  it('includes canceled', () => {
    assert.ok(DEFAULT_CAPTURE_STATUS_PATTERNS.includes('canceled'));
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
