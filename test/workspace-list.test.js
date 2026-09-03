'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  uniqueCompanies,
  appendWorkspaceRows,
  workspaceOptionLabels,
} = require('../lib/workspace-list.js');

describe('uniqueCompanies', () => {
  it('T1 keeps first of duplicate company ids', () => {
    const rows = uniqueCompanies([
      { id: 'co1', name: 'Acme' },
      { id: 'co1', name: 'Acme dup' },
      { company_id: 'co2', name: 'Beta' },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].name, 'Acme');
    assert.equal(String(rows[1].id || rows[1].company_id), 'co2');
  });

  it('T2 skips inactive memberships', () => {
    const rows = uniqueCompanies([
      { id: 'co1', name: 'Live', is_active: true },
      { id: 'co2', name: 'Gone', is_active: false },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'co1');
  });
});

describe('appendWorkspaceRows', () => {
  it('T3 skips duplicate workspace ids across companies', () => {
    const merged = [];
    const seenIds = new Set();
    appendWorkspaceRows(merged, seenIds, [{ id: 'ws1', name: '用户的工作空间' }], {
      id: 'co1',
      name: 'Acme',
    });
    appendWorkspaceRows(merged, seenIds, [{ id: 'ws1', name: '用户的工作空间' }], {
      id: 'co2',
      name: 'Beta',
    });
    assert.equal(merged.length, 1);
    assert.equal(merged[0].company_id, 'co1');
    assert.equal(merged[0].company_name, 'Acme');
  });
});

describe('workspaceOptionLabels', () => {
  it('T4 qualifies same default name with company when two tenants', () => {
    const labels = workspaceOptionLabels([
      { id: 'ws1', name: '用户的工作空间', company_id: 'co1', company_name: '个人空间' },
      { id: 'ws2', name: '用户的工作空间', company_id: 'co2', company_name: 'Acme' },
    ]);
    assert.deepEqual(labels, [
      '用户的工作空间 · 个人空间',
      '用户的工作空间 · Acme',
    ]);
  });

  it('T5 keeps bare name for a single tenant without collisions', () => {
    const labels = workspaceOptionLabels([
      { id: 'ws1', name: '研发空间', company_id: 'co1', company_name: 'Acme' },
    ]);
    assert.deepEqual(labels, ['研发空间']);
  });

  it('appends short id when company-qualified labels still collide', () => {
    const labels = workspaceOptionLabels([
      { id: 'aaaaaaaa111111', name: '用户的工作空间', company_id: 'co1', company_name: 'Acme' },
      { id: 'bbbbbbbb222222', name: '用户的工作空间', company_id: 'co1', company_name: 'Acme' },
    ]);
    assert.deepEqual(labels, [
      '用户的工作空间 · Acme (#111111)',
      '用户的工作空间 · Acme (#222222)',
    ]);
  });
});

describe('tenant membership denial vs plugin/web session mismatch', () => {
  const {
    isTenantMembershipDenied,
    MEMBERSHIP_MISMATCH_HINT,
    loadWorkspacesAcrossCompanies,
  } = require('../lib/workspace-list.js');

  it('detects 您不是该公司的成员 from API error text', () => {
    assert.equal(isTenantMembershipDenied(new Error('您不是该公司的成员')), true);
    assert.equal(isTenantMembershipDenied(new Error('API GET /x → 403: 您不是该公司的成员')), true);
    assert.equal(isTenantMembershipDenied(new Error('network down')), false);
  });

  it('hint tells the user plugin login is independent of the website session', () => {
    assert.match(MEMBERSHIP_MISMATCH_HINT, /您不是该公司的成员/);
    assert.match(MEMBERSHIP_MISMATCH_HINT, /插件登录与网页登录是两套会话/);
  });

  it('skips a 403 membership company and keeps the next tenant workspaces', async () => {
    const { merged, deniedCount } = await loadWorkspacesAcrossCompanies(
      [
        { id: 'co-web', name: 'WebsiteTenant' },
        { id: 'co-plugin', name: 'PluginTenant' },
      ],
      async (cid) => {
        if (cid === 'co-web') {
          const err = new Error('您不是该公司的成员');
          err.traceId = 'trace-denied-web';
          throw err;
        }
        return [{ id: 'ws-ok', name: '用户的工作空间' }];
      },
    );
    assert.equal(deniedCount, 1);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'ws-ok');
    assert.equal(merged[0].company_id, 'co-plugin');
  });

  it('returns deniedCount when every company is a membership 403', async () => {
    const { merged, deniedCount, lastDeniedTraceId } = await loadWorkspacesAcrossCompanies(
      [{ id: 'co1', name: 'A' }, { id: 'co2', name: 'B' }],
      async () => {
        const err = new Error('您不是该公司的成员');
        err.traceId = 'trace-all-denied';
        throw err;
      },
    );
    assert.equal(merged.length, 0);
    assert.equal(deniedCount, 2);
    assert.equal(lastDeniedTraceId, 'trace-all-denied');
  });
});
