'use strict';

const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const { resolvePageAdvisorFailTraceId } = require('../lib/page-advisor-fail-trace-id.js');

function jobWithResolvedTrace(resolvedId, body = {}) {
  const job = { status: 'failed', ...body };
  if (resolvedId != null && resolvedId !== '') {
    Object.defineProperty(job, '_resolvedTraceId', {
      value: resolvedId,
      enumerable: false,
      configurable: true,
    });
  }
  return job;
}

describe('PageAdvisorFailTraceId.resolvePageAdvisorFailTraceId (injected deps)', () => {
  it('returns job.trace_id when present (direct fallback path)', () => {
    const tid = resolvePageAdvisorFailTraceId({ trace_id: '  body-trace  ' }, '');
    assert.equal(tid, 'body-trace');
  });

  it('returns seed when job lacks trace fields (direct fallback path)', () => {
    const tid = resolvePageAdvisorFailTraceId(null, 'create-seed');
    assert.equal(tid, 'create-seed');
  });

  it('uses pickJobTraceId when provided (PageAdvisorAPI semantics)', () => {
    const pick = (job, seed) => {
      const fromBody = String(job?.trace_id || job?.traceId || '').trim();
      if (fromBody) return fromBody;
      const prior = String(seed || '').trim();
      if (prior) return prior;
      return String(job?._resolvedTraceId || '').trim();
    };

    assert.equal(
      resolvePageAdvisorFailTraceId(jobWithResolvedTrace('resolved-only'), '', { pickJobTraceId: pick }),
      'resolved-only',
    );
    assert.equal(
      resolvePageAdvisorFailTraceId(jobWithResolvedTrace('resolved-only'), 'seed-wins', { pickJobTraceId: pick }),
      'seed-wins',
    );
    assert.equal(
      resolvePageAdvisorFailTraceId({ trace_id: 'from-body' }, 'seed', { pickJobTraceId: pick }),
      'from-body',
    );
  });

  it('uses timestamp fallback when pick and mint yield empty', () => {
    const tid = resolvePageAdvisorFailTraceId(null, '', {
      pickJobTraceId: () => '',
      mintTraceId: () => '',
      now: () => 999,
    });
    assert.equal(tid, 'page-advisor-failed-999');
  });

  it('mints via mintTraceId when pick and seed yield empty', () => {
    const tid = resolvePageAdvisorFailTraceId({}, '', {
      pickJobTraceId: () => '',
      mintTraceId: () => 'minted-trace',
    });
    assert.equal(tid, 'minted-trace');
  });

  it('uses timestamp fallback when pick, seed, and mint are empty', () => {
    const tid = resolvePageAdvisorFailTraceId(null, '', {
      pickJobTraceId: () => '',
      mintTraceId: () => '',
      now: () => 1700000000000,
      fallbackPrefix: 'page-advisor-failed',
    });
    assert.equal(tid, 'page-advisor-failed-1700000000000');
  });
});

describe('PageAdvisorFailTraceId with PageAdvisorAPI.pickJobTraceId (SW-like globals)', () => {
  function loadPageAdvisorApiStack() {
    const sandbox = { console, globalThis: null };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, 'lib/api-http.js'), 'utf8'),
      sandbox,
      { filename: 'api-http.js' },
    );
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, 'lib/page-advisor-api.js'), 'utf8'),
      sandbox,
      { filename: 'page-advisor-api.js' },
    );
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, 'lib/page-advisor-fail-trace-id.js'), 'utf8'),
      sandbox,
      { filename: 'page-advisor-fail-trace-id.js' },
    );
    return sandbox;
  }

  it('delegates to PageAdvisorAPI.pickJobTraceId then mints when still empty', () => {
    const sandbox = loadPageAdvisorApiStack();
    sandbox.APIHttp = { newRequestTraceId: () => 'sw-mint-trace' };

    const job = jobWithResolvedTrace('poll-resolved', { trace_id: '' });
    const tid = sandbox.PageAdvisorFailTraceId.resolvePageAdvisorFailTraceId(job, '');
    assert.equal(tid, 'poll-resolved');
  });

  it('uses create seed before job _resolvedTraceId per pickJobTraceId', () => {
    const sandbox = loadPageAdvisorApiStack();
    const job = jobWithResolvedTrace('poll-resolved');
    const tid = sandbox.PageAdvisorFailTraceId.resolvePageAdvisorFailTraceId(job, 'create-trace');
    assert.equal(tid, 'create-trace');
  });

  it('mints when job and seed lack traceId', () => {
    const sandbox = loadPageAdvisorApiStack();
    sandbox.APIHttp.newRequestTraceId = () => 'fresh-mint';
    const tid = sandbox.PageAdvisorFailTraceId.resolvePageAdvisorFailTraceId({}, '');
    assert.equal(tid, 'fresh-mint');
  });
});
