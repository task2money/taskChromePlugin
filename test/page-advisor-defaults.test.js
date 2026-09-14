'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolvePageAdvisorWorkspace,
  resolveDefaultProjectId,
} = require('../lib/page-advisor-defaults.js');

describe('resolvePageAdvisorWorkspace', () => {
  const workspaces = [
    { id: 'ws1', company_id: 'c1', name: 'A' },
    { id: 'ws2', companyId: 'c2', name: 'B' },
  ];

  it('prefers float workspace+company', () => {
    const r = resolvePageAdvisorWorkspace({
      floatWorkspaceId: 'ws1',
      floatCompanyId: 'c1',
      lastWorkspaceId: 'ws2',
      workspaces,
    });
    assert.deepEqual(r, { workspaceId: 'ws1', companyId: 'c1', source: 'float' });
  });

  it('falls back to lastWorkspaceId + workspaces list', () => {
    const r = resolvePageAdvisorWorkspace({
      floatWorkspaceId: '',
      floatCompanyId: '',
      lastWorkspaceId: 'ws2',
      workspaces,
    });
    assert.deepEqual(r, { workspaceId: 'ws2', companyId: 'c2', source: 'storage' });
  });

  it('resolves company for float workspace without companyId', () => {
    const r = resolvePageAdvisorWorkspace({
      floatWorkspaceId: 'ws1',
      floatCompanyId: '',
      lastWorkspaceId: '',
      workspaces,
    });
    assert.deepEqual(r, { workspaceId: 'ws1', companyId: 'c1', source: 'float' });
  });

  it('returns empty when nothing matches', () => {
    const r = resolvePageAdvisorWorkspace({
      lastWorkspaceId: 'missing',
      workspaces,
    });
    assert.deepEqual(r, { workspaceId: '', companyId: '', source: '' });
  });
});

describe('resolveDefaultProjectId', () => {
  const projects = [{ id: 'p1' }, { id: 'p2' }, { _id: 'p3' }];

  it('picks preferred id when available', () => {
    assert.equal(resolveDefaultProjectId(['p2', 'p9'], projects), 'p2');
  });

  it('falls back to first project when preferred missing', () => {
    assert.equal(resolveDefaultProjectId(['gone'], projects), 'p1');
  });

  it('returns empty when no projects', () => {
    assert.equal(resolveDefaultProjectId(['p1'], []), '');
  });
});
