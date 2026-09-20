'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./helpers/txRuntime.js').installTxRuntime();

const PageAdvisorAPI = require('../lib/page-advisor-api.js');
const ClickGuard = require('../lib/click-guard.js');

describe('page-advisor-api endpoints', () => {
  it('paths include tenant_id templates', () => {
    assert.match(PageAdvisorAPI.ENDPOINTS.suggestJobs, /tenant_id\/\{tenantId\}/);
    assert.match(PageAdvisorAPI.ENDPOINTS.suggestJob, /suggest-jobs\/\{jobId\}/);
    assert.match(PageAdvisorAPI.ENDPOINTS.agentResourceStatus, /agent-resource-status/);
  });
});

describe('page-advisor-api createSuggestJob + poll (mocked fetch)', () => {
  let origFetch;
  const session = { baseUrl: 'https://api.example.com', token: 'at_test' };

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('POST sends Idempotency-Key and returns job_id', async () => {
    let seen;
    globalThis.fetch = async (url, opts) => {
      seen = { url: String(url), opts };
      return {
        ok: true,
        status: 202,
        headers: {
          get: (name) => {
            if (String(name).toLowerCase() === 'content-type') return 'application/json';
            return '';
          },
        },
        json: async () => ({ job_id: 'j1', status: 'queued' }),
        text: async () => '',
      };
    };
    const data = await PageAdvisorAPI.createSuggestJob(
      't1',
      { workspace_id: 'w1', page_url: 'https://x', page_title: '', page_text: 'hi' },
      'ik-abc',
      session,
    );
    assert.equal(data.job_id, 'j1');
    // Body omitted trace_id → stamp fills enumerable trace_id from client X-Trace-Id.
    assert.ok(String(data.trace_id || '').trim(), 'create must stamp enumerable trace_id');
    assert.match(seen.url, /\/api\/page-advisor\/tenant_id\/t1\/suggest-jobs\//);
    assert.equal(seen.opts.headers['Idempotency-Key'], 'ik-abc');
    assert.ok(seen.opts.headers['X-Trace-Id']);
    assert.equal(seen.opts.credentials, 'omit');
  });

  it('GET job prefers body.trace_id on _resolvedTraceId (not poll request id)', async () => {
    let seenTraceHeader = '';
    globalThis.fetch = async (_url, opts) => {
      seenTraceHeader = String(opts?.headers?.['X-Trace-Id'] || '');
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name) => {
            if (String(name).toLowerCase() === 'content-type') return 'application/json';
            if (String(name).toLowerCase() === 'x-trace-id') return seenTraceHeader;
            return '';
          },
        },
        json: async () => ({
          job_id: 'j1',
          status: 'failed',
          error_message: "parse suggestions json: invalid character 'f'",
          trace_id: '87a7e674-a207-4542-a41f-4b5a1eafbbd7',
        }),
        text: async () => '',
      };
    };
    const job = await PageAdvisorAPI.getSuggestJob('t1', 'j1', session);
    assert.equal(job.trace_id, '87a7e674-a207-4542-a41f-4b5a1eafbbd7');
    assert.equal(job._resolvedTraceId, '87a7e674-a207-4542-a41f-4b5a1eafbbd7');
    assert.notEqual(job._resolvedTraceId, seenTraceHeader);
    assert.equal(
      PageAdvisorAPI.pickJobTraceId(job, ''),
      '87a7e674-a207-4542-a41f-4b5a1eafbbd7',
    );
  });

  it('422 AGENT_RESOURCE_NOT_CONFIGURED surfaces errorCode', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 422,
      headers: { get: () => '' },
      text: async () => JSON.stringify({
        error_code: 'AGENT_RESOURCE_NOT_CONFIGURED',
        detail: 'no agent',
      }),
      json: async () => ({}),
    });
    await assert.rejects(
      () => PageAdvisorAPI.createSuggestJob('t1', { workspace_id: 'w1', page_url: 'u' }, 'ik', session),
      (err) => {
        assert.equal(err.status, 422);
        assert.equal(err.errorCode, 'AGENT_RESOURCE_NOT_CONFIGURED');
        return true;
      },
    );
  });

  it('pollSuggestJob backs off until succeeded', async () => {
    let n = 0;
    const sleeps = [];
    globalThis.fetch = async () => {
      n += 1;
      const status = n < 3 ? 'running' : 'succeeded';
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          job_id: 'j1',
          status,
          suggestions: status === 'succeeded'
            ? [{ id: 's1', title: 't', detail: 'd' }]
            : undefined,
        }),
        text: async () => '',
      };
    };
    const job = await PageAdvisorAPI.pollSuggestJob('t1', 'j1', {
      session,
      initialDelayMs: 1,
      maxDelayMs: 2,
      maxMs: 5000,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    assert.equal(job.status, 'succeeded');
    assert.equal(job.suggestions.length, 1);
    assert.ok(sleeps.length >= 1);
  });

  it('getAgentResourceStatus hits query workspace_id', async () => {
    let seenUrl = '';
    globalThis.fetch = async (url) => {
      seenUrl = String(url);
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ available: true, source: 'workspace' }),
        text: async () => '',
      };
    };
    const data = await PageAdvisorAPI.getAgentResourceStatus('t1', 'w9', session);
    assert.equal(data.available, true);
    assert.match(seenUrl, /agent-resource-status\/\?workspace_id=w9/);
  });
  it('pollSuggestJob timeout attaches traceId from job body', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name) => {
          if (String(name).toLowerCase() === 'content-type') return 'application/json';
          if (String(name).toLowerCase() === 'x-trace-id') return 'hdr-poll-tid';
          return '';
        },
      },
      json: async () => ({
        job_id: 'j1',
        status: 'running',
        trace_id: 'job-create-tid',
      }),
      text: async () => '',
    });
    await assert.rejects(
      () => PageAdvisorAPI.pollSuggestJob('t1', 'j1', {
        session,
        initialDelayMs: 1,
        maxDelayMs: 1,
        maxMs: 5,
        sleep: async () => {},
      }),
      (err) => {
        assert.equal(err.errorCode, 'SUGGEST_JOB_TIMEOUT');
        assert.equal(err.traceId, 'job-create-tid');
        return true;
      },
    );
  });

  it('pollSuggestJob timeout always attaches non-empty traceId', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : ''),
      },
      json: async () => ({ job_id: 'j1', status: 'queued' }),
      text: async () => '',
    });
    await assert.rejects(
      () => PageAdvisorAPI.pollSuggestJob('t1', 'j1', {
        session,
        initialDelayMs: 1,
        maxDelayMs: 1,
        maxMs: 5,
        sleep: async () => {},
      }),
      (err) => {
        assert.equal(err.errorCode, 'SUGGEST_JOB_TIMEOUT');
        assert.ok(String(err.traceId || '').trim(), 'timeout must never omit traceId');
        return true;
      },
    );
  });
});

describe('click-guard anti-replay', () => {
  it('skips in-flight and mints Idempotency-Key once per accepted run', async () => {
    let now = 1000;
    const guard = ClickGuard.createClickGuard({
      debounceMs: 50,
      now: () => now,
      newKey: () => 'fixed-key',
    });
    let runs = 0;
    const p1 = guard.run(async ({ idempotencyKey }) => {
      assert.equal(idempotencyKey, 'fixed-key');
      runs += 1;
      await new Promise((r) => setTimeout(r, 20));
      return 'ok';
    });
    const p2 = guard.run(async () => { runs += 1; });
    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(a.skipped, false);
    assert.equal(b.skipped, true);
    assert.equal(b.reason, 'in-flight');
    assert.equal(runs, 1);
    now = 1001;
    const d = await guard.run(async () => 'x');
    assert.equal(d.skipped, true);
    assert.equal(d.reason, 'debounce');
  });
});

describe('page-advisor wiring contracts', () => {
  const root = path.join(__dirname, '..');

  it('manifest registers page-optimization-suggest Alt+Z and bumps version', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const cmd = manifest.commands['page-optimization-suggest'];
    assert.ok(cmd);
    assert.equal(cmd.suggested_key.default, 'Alt+Z');
    assert.equal(cmd.suggested_key.mac, 'Alt+Z');
    const regionCmd = manifest.commands['page-optimization-suggest-region'];
    assert.ok(regionCmd);
    assert.equal(regionCmd.suggested_key.default, 'Alt+Shift+Z');
    assert.equal(regionCmd.suggested_key.mac, 'Alt+Shift+Z');
    assert.ok(manifest.content_scripts[0].js.includes('lib/page-context.js'));
    assert.ok(manifest.content_scripts[0].js.includes('lib/page-advisor-region.js'));
    assert.ok(manifest.content_scripts[0].js.includes('content/float-page-advisor.js'));
    assert.ok(manifest.content_scripts[0].js.includes('content/float-page-advisor-region.js'));
    assert.ok(manifest.content_scripts[0].js.includes('lib/page-advisor-preview.js'));
    assert.ok(manifest.content_scripts[0].css.includes('content/content-region.css'));
    assert.match(manifest.version, /^1\.8\.(2[9]|[3-9]\d|\d{3,})$/);
  });

  it('SW imports page-advisor and handles command', () => {
    const { readSWLocalBundle } = require('./helpers/swBundle.js');
    const sw = readSWLocalBundle();
    assert.match(sw, /page-optimization-suggest/);
    assert.match(sw, /page-optimization-suggest-region/);
    assert.match(sw, /runPageOptimizationSuggest/);
    assert.match(sw, /handlePageOptimizationSuggestRegionCommand/);
    assert.match(sw, /AGENT_RESOURCE_NOT_CONFIGURED/);
    const swMain = fs.readFileSync(path.join(root, 'background/service-worker.js'), 'utf8');
    assert.match(swMain, /page-advisor-api\.js/);
    assert.match(swMain, /sw-page-advisor\.js/);
  });

  it('content wires region select and Alt+Z/Alt+Shift+Z page fallbacks', () => {
    const content = fs.readFileSync(path.join(root, 'content/content.js'), 'utf8');
    assert.match(content, /startPageAdvisorRegionSelect/);
    const pick = fs.readFileSync(path.join(root, 'content/float-pick.js'), 'utf8');
    assert.match(pick, /PAGE_ADVISOR_REGION_SHORTCUT|Alt\+Shift\+Z/);
    assert.match(pick, /PAGE_ADVISOR_SHORTCUT|Alt\+Z/);
    const region = fs.readFileSync(path.join(root, 'content/float-page-advisor-region.js'), 'utf8');
    assert.match(region, /startPageAdvisorRegionSelect/);
    assert.match(region, /pageOptimizationSuggest/);
    const layer = fs.readFileSync(path.join(root, 'content/float-page-advisor-layer.js'), 'utf8');
    assert.match(layer, /capturePageContextForElements/);
    assert.match(layer, /getPendingPageAdvisorElements/);
    assert.match(layer, /capturePageContextInRect/);
    assert.match(layer, /getPendingPageAdvisorRegion/);
    const swAdvisor = fs.readFileSync(path.join(root, 'background/sw-page-advisor.js'), 'utf8');
    assert.match(swAdvisor, /clearLegacyPageAdvisorChromeShortcuts/);
    const swMain = fs.readFileSync(path.join(root, 'background/service-worker.js'), 'utf8');
    assert.match(swMain, /clearLegacyPageAdvisorChromeShortcuts/);
  });

  it('content confirm path does not call createTask', () => {
    const ui = fs.readFileSync(path.join(root, 'content/float-page-advisor.js'), 'utf8');
    assert.match(ui, /appendSuggestionsToDescription/);
    assert.match(ui, /createClickGuard|pageAdvisorBusy/);
    assert.doesNotMatch(ui, /action:\s*['"]createTask['"]/);
    assert.doesNotMatch(ui, /\.createTask\s*\(/);
  });
});
