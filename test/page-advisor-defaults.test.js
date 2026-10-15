'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolvePageAdvisorWorkspace,
  pickWorkspaceEntry,
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

  // OPT-20261014-037：登录后从未打开过弹窗（lastWorkspaceId 为空）直接按 Alt+Z 时，
  // 必须落到平台默认工作空间，而不是提示「请先在扩展弹窗选择」。
  const defaultFirst = [
    { id: 'ws-other', company_id: 'c-other', name: '别的租户' },
    { id: 'ws-def', company_id: 'c-def', is_default: true, name: '默认' },
  ];

  it('falls back to the platform default workspace when nothing was chosen yet', () => {
    const r = resolvePageAdvisorWorkspace({
      floatWorkspaceId: '',
      floatCompanyId: '',
      lastWorkspaceId: '',
      workspaces: defaultFirst,
    });
    assert.deepEqual(r, { workspaceId: 'ws-def', companyId: 'c-def', source: 'default' });
  });

  it('prefers is_current default when the user belongs to several tenants', () => {
    const r = resolvePageAdvisorWorkspace({
      lastWorkspaceId: '',
      workspaces: [
        { id: 'ws-a', company_id: 'c-a', is_default: true },
        { id: 'ws-b', company_id: 'c-b', is_default: true, is_current: true },
      ],
    });
    assert.equal(r.workspaceId, 'ws-b');
    assert.equal(r.source, 'default');
  });

  it('keeps a manually chosen workspace even when another one is the default', () => {
    const r = resolvePageAdvisorWorkspace({
      lastWorkspaceId: 'ws-other',
      lastWorkspaceManual: true,
      workspaces: defaultFirst,
    });
    assert.deepEqual(r, { workspaceId: 'ws-other', companyId: 'c-other', source: 'storage' });
  });

  it('lets the backend default override an auto-selected (non-manual) workspace', () => {
    const r = resolvePageAdvisorWorkspace({
      lastWorkspaceId: 'ws-other',
      lastWorkspaceManual: false,
      workspaces: defaultFirst,
    });
    assert.deepEqual(r, { workspaceId: 'ws-def', companyId: 'c-def', source: 'default' });
  });

  it('keeps an auto-selected workspace when no platform default is published', () => {
    const r = resolvePageAdvisorWorkspace({
      lastWorkspaceId: 'ws1',
      lastWorkspaceManual: false,
      workspaces,
    });
    assert.deepEqual(r, { workspaceId: 'ws1', companyId: 'c1', source: 'storage' });
  });

  it('stays empty when the workspace list could not be fetched', () => {
    const r = resolvePageAdvisorWorkspace({
      floatWorkspaceId: '',
      floatCompanyId: '',
      lastWorkspaceId: '',
      workspaces: [],
    });
    assert.deepEqual(r, { workspaceId: '', companyId: '', source: '' });
  });
});

describe('pickWorkspaceEntry', () => {
  const rows = [
    { id: 'ws-other', company_id: 'c-other' },
    { id: 'ws-def', company_id: 'c-def', is_default: true },
  ];

  it('uses the remembered workspace when it is still available', () => {
    assert.equal(pickWorkspaceEntry(rows, 'ws-other').id, 'ws-other');
  });

  // 曾经的 rows[0] 兜底会取到非默认租户的智能体。
  it('falls back to the platform default instead of rows[0]', () => {
    assert.equal(pickWorkspaceEntry(rows, '').id, 'ws-def');
    assert.equal(pickWorkspaceEntry(rows, 'ws-gone').id, 'ws-def');
  });

  it('returns null for an empty list (fetch failed)', () => {
    assert.equal(pickWorkspaceEntry([], 'ws-def'), null);
    assert.equal(pickWorkspaceEntry(null, ''), null);
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
