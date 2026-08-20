'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const API = require('../lib/api.js');

function jsonOk(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => '' },
  };
}

describe('API default endpoints follow current gateway convention', () => {
  it('T1 workspaces uses /api/projects/workspaces/tenant_id/{companyId}', () => {
    const ep = API.getDefaultEndpoints();
    assert.equal(ep.workspaces, '/api/projects/workspaces/tenant_id/{companyId}');
  });

  it('T2 project/task/cloud defaults no longer use retired /api/tenant/{companyId}/workspaces', () => {
    const ep = API.getDefaultEndpoints();
    assert.equal(ep.projects, '/api/projects/tenant_id/{companyId}?workspace_id={workspaceId}');
    assert.equal(
      ep.createTask,
      '/api/tasks/todos/tenant_id/{companyId}/workspace_id/{workspaceId}/',
    );
    assert.equal(
      ep.batchTasks,
      '/api/tasks/todos/tenant_id/{companyId}/workspace_id/{workspaceId}/',
    );
    assert.equal(
      ep.progressColumns,
      '/api/projects/workspaces/tenant_id/{companyId}/{workspaceId}/progress-system/',
    );
    assert.equal(
      ep.branches,
      '/api/projects/tenant_id/{companyId}/{projectId}/branches/?repo_url={repoUrl}',
    );
    assert.equal(
      ep.deliverableTypes,
      '/api/projects/manage-deliverable-system/tenant_id/{companyId}?workspace_id={workspaceId}',
    );
    assert.equal(ep.installedImages, '/api/cloud/installed-images/tenant_id/{companyId}');
    assert.equal(
      ep.aidevResolve,
      '/api/projects/aidev/tenant_id/{companyId}/resolve?service_id={serviceId}',
    );
    assert.equal(
      ep.members,
      '/api/tenant/{companyId}/accounts/members/company_members/',
    );
    for (const [name, path] of Object.entries(ep)) {
      assert.equal(
        path.includes('/api/tenant/{companyId}/workspaces'),
        false,
        `${name} still uses retired workspaces path: ${path}`,
      );
    }
  });
});

describe('getWorkspaces / getMembers request URLs', () => {
  let origFetch;
  let calls;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    calls = [];
    API.init('https://example.test', 'tok', null, 'u1');
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    API.clearSession();
  });

  it('T3 getWorkspaces(companyId) hits convention path, not /api/tenant/.../workspaces', async () => {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return jsonOk([{ id: 'ws1', name: 'WS1', company_id: 'co1' }]);
    };
    const rows = await API.getWorkspaces('co1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'ws1');
    assert.equal(calls.length, 1);
    assert.match(calls[0], /https:\/\/example\.test\/api\/projects\/workspaces\/tenant_id\/co1$/);
    assert.equal(calls.some((u) => u.includes('/api/tenant/co1/workspaces')), false);
  });

  it('T4 getWorkspaces() loads me then each company workspace list', async () => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/api/user/u1/accounts/users/me/')) {
        return jsonOk({
          id: 'u1',
          companies: [{ id: 'co1', name: 'Acme' }],
        });
      }
      if (u.includes('/api/projects/workspaces/tenant_id/co1')) {
        return jsonOk([{ id: 'ws1', name: 'WS1' }]);
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '{"error":"not found"}', headers: { get: () => '' } };
    };
    const rows = await API.getWorkspaces();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].company_id, 'co1');
    assert.equal(rows[0].company_name, 'Acme');
    assert.equal(calls[0].includes('/api/user/u1/accounts/users/me/'), true);
    assert.equal(calls[1].includes('/api/projects/workspaces/tenant_id/co1'), true);
  });

  it('T5 getMembers hits company_members and unwraps { members }', async () => {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return jsonOk({
        members: [{ id: 'm1', member_name: 'Alice', user_id: 'u1' }],
        meta: { has_permission: true },
      });
    };
    const members = await API.getMembers('co1');
    assert.equal(members.length, 1);
    assert.equal(members[0].id, 'm1');
    assert.match(
      calls[0],
      /https:\/\/example\.test\/api\/tenant\/co1\/accounts\/members\/company_members\/$/,
    );
  });

  // OPT-20260820-040: 带 workspaceId 时负责人/协作人走 workspace-collaborators
  it('T5b getMembers with workspaceId hits workspace-collaborators (non-admin visible)', async () => {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return jsonOk([
        { id: 'cm1', member_name: 'Bob', user: 'u2', username: 'Bob' },
        { id: 'cm2', member_name: 'Carol', user: 'u3', username: 'Carol' },
      ]);
    };
    const members = await API.getMembers('co1', 'ws1');
    assert.equal(members.length, 2);
    assert.equal(members[0].user, 'u2');
    assert.match(
      calls[0],
      /https:\/\/example\.test\/api\/projects\/workspace-access\/workspace-collaborators\/tenant_id\/co1\/\?workspace_id=ws1$/,
    );
  });

  it('T5c getMembers without workspaceId still falls back to company_members', async () => {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return jsonOk({ members: [{ id: 'm1', member_name: 'Alice', user_id: 'u1' }] });
    };
    const members = await API.getMembers('co1', undefined);
    assert.equal(members.length, 1);
    assert.match(calls[0], /\/api\/tenant\/co1\/accounts\/members\/company_members\/$/);
  });
});

describe('OPT-20260820-039: deprecated /api/tenant/{companyId}/... mapping dropped', () => {
  it('T6 legacy workspaces/projects mapping does not override new defaults', () => {
    API.init('https://example.test', 'tok', {
      workspaces: '/api/tenant/{companyId}/workspaces',
      projects: '/api/tenant/{companyId}/projects',
      installedImages: '/api/tenant/{companyId}/installed-images',
    }, 'u1');
    const ep = API.getEndpointMapping();
    assert.equal(ep.workspaces, '/api/projects/workspaces/tenant_id/{companyId}');
    assert.equal(ep.projects, '/api/projects/tenant_id/{companyId}?workspace_id={workspaceId}');
    assert.equal(ep.installedImages, '/api/cloud/installed-images/tenant_id/{companyId}');
  });

  it('T7 legacy mapping with concrete tenant id is dropped', () => {
    API.init('https://example.test', 'tok', {
      projects: '/api/tenant/877397588196749312/projects?workspace_id=1',
      workspaces: '/api/tenant/877397588196749312/workspace/',
      members: '/api/tenant/{companyId}/accounts/members/company_members/',
    }, 'u1');
    const ep = API.getEndpointMapping();
    assert.equal(ep.projects, '/api/projects/tenant_id/{companyId}?workspace_id={workspaceId}');
    assert.equal(ep.workspaces, '/api/projects/workspaces/tenant_id/{companyId}');
    // members 走 company_members 是合法端点，不应被误删
    assert.equal(ep.members, '/api/tenant/{companyId}/accounts/members/company_members/');
  });

  it('T8 setEndpointMapping also sanitizes legacy keys', () => {
    API.init('https://example.test', 'tok', null, 'u1');
    API.setEndpointMapping({ aidevResolve: '/api/tenant/{companyId}/aidev/resolve' });
    const ep = API.getEndpointMapping();
    assert.equal(ep.aidevResolve, '/api/projects/aidev/tenant_id/{companyId}/resolve?service_id={serviceId}');
  });

  it('T9 non-legacy custom mapping survives', () => {
    API.init('https://example.test', 'tok', {
      clientIp: '/custom/client-ip/',
    }, 'u1');
    const ep = API.getEndpointMapping();
    assert.equal(ep.clientIp, '/custom/client-ip/');
  });
});
