'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldFetchClientPublicIp,
  withClientPublicIp,
  attachClientPublicIpForAutoRun,
} = require('../lib/client-public-ip.js');

describe('shouldFetchClientPublicIp', () => {
  it('true when auto_run and missing ip', () => {
    assert.equal(shouldFetchClientPublicIp({ auto_run: true }), true);
  });

  it('false when auto_run false', () => {
    assert.equal(shouldFetchClientPublicIp({ auto_run: false }), false);
  });

  it('false when ip already present', () => {
    assert.equal(
      shouldFetchClientPublicIp({ auto_run: true, client_public_ip: '203.0.113.1' }),
      false,
    );
  });
});

describe('withClientPublicIp', () => {
  it('writes non-empty ip', () => {
    assert.equal(withClientPublicIp({ title: 't' }, '203.0.113.9').client_public_ip, '203.0.113.9');
  });

  it('ignores empty ip', () => {
    assert.equal(withClientPublicIp({ title: 't' }, '  ').client_public_ip, undefined);
  });
});

describe('attachClientPublicIpForAutoRun', () => {
  it('fetches and writes when auto_run', async () => {
    const out = await attachClientPublicIpForAutoRun(
      { title: 't', auto_run: true },
      async () => '198.51.100.7',
    );
    assert.equal(out.client_public_ip, '198.51.100.7');
  });

  it('skips fetch when ip already set', async () => {
    let called = 0;
    const out = await attachClientPublicIpForAutoRun(
      { auto_run: true, client_public_ip: '203.0.113.1' },
      async () => {
        called += 1;
        return '9.9.9.9';
      },
    );
    assert.equal(called, 0);
    assert.equal(out.client_public_ip, '203.0.113.1');
  });

  it('does not throw when fetch fails', async () => {
    const out = await attachClientPublicIpForAutoRun(
      { auto_run: true },
      async () => {
        throw new Error('network');
      },
    );
    assert.equal(out.client_public_ip, undefined);
    assert.equal(out.auto_run, true);
  });
});
