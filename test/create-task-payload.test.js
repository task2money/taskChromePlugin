'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePriority,
  getDefaultTaskDeadline,
  buildProjectsFromSelection,
  buildFeatureParamsFields,
  validateCreateTaskForm,
  buildCreateTaskPayload,
  repoBaseBranchKey,
  normalizeAssignees,
  buildRepoBaseEditorsHtml,
  shouldEnableDescReset,
  parseRemoteBranchNames,
  branchDatalistOptionsHtml,
  repoBaseDatalistId,
  REPO_BASE_EMPTY_HINT,
} = require('../lib/create-task-payload.js');

describe('normalizePriority', () => {
  it('maps work-panel numeric values 0/1/2', () => {
    assert.equal(normalizePriority(0), 0);
    assert.equal(normalizePriority('0'), 0);
    assert.equal(normalizePriority(1), 1);
    assert.equal(normalizePriority('1'), 1);
    assert.equal(normalizePriority(2), 2);
    assert.equal(normalizePriority('2'), 2);
  });

  it('maps labels to work-panel semantics: 0=高 1=中 2=低', () => {
    assert.equal(normalizePriority('high'), 0);
    assert.equal(normalizePriority('medium'), 1);
    assert.equal(normalizePriority('low'), 2);
    assert.equal(normalizePriority('critical'), 0);
  });

  it('defaults unknown to medium (1)', () => {
    assert.equal(normalizePriority(''), 1);
    assert.equal(normalizePriority(undefined), 1);
    assert.equal(normalizePriority('urgent'), 1);
  });
});

describe('getDefaultTaskDeadline', () => {
  it('returns datetime-local string at least 7 days ahead ending on Thursday', () => {
    const fixed = new Date('2026-07-13T10:00:00');
    const deadline = getDefaultTaskDeadline(fixed);
    assert.match(deadline, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const parsed = new Date(deadline);
    assert.ok(parsed.getTime() > fixed.getTime());
    assert.equal(parsed.getDay(), 4);
  });
});

describe('buildProjectsFromSelection', () => {
  it('expands multi-repo project with repo_index and shared base/target branch', () => {
    const projects = buildProjectsFromSelection({
      projectIds: ['p1'],
      projectsList: [{
        id: 'p1',
        git_repos: ['https://a.git', 'https://b.git'],
        default_branch: 'develop',
      }],
      workBranch: 'feature/x',
      baseBranch: 'main',
    });
    assert.deepEqual(projects, [
      { project_id: 'p1', repo_index: 0, base_branch: 'main', target_branch: 'feature/x' },
      { project_id: 'p1', repo_index: 1, base_branch: 'main', target_branch: 'feature/x' },
    ]);
  });

  it('falls back to project default_branch then main when baseBranch empty', () => {
    const projects = buildProjectsFromSelection({
      projectIds: ['p2'],
      projectsList: [{ id: 'p2', git_repos: [], default_branch: 'develop' }],
      workBranch: 'feature/y',
      baseBranch: '',
    });
    assert.deepEqual(projects, [
      { project_id: 'p2', repo_index: 0, base_branch: 'develop', target_branch: 'feature/y' },
    ]);
  });

  it('uses per-repo base_branch map over global baseBranch (work-panel parity)', () => {
    const projects = buildProjectsFromSelection({
      projectIds: ['p1'],
      projectsList: [{
        id: 'p1',
        git_repos: ['https://a.git', 'https://b.git'],
        default_branch: 'develop',
      }],
      workBranch: 'feature/x',
      baseBranch: 'main',
      repoBaseBranches: {
        'p1:0': 'release/a',
        'p1:1': 'hotfix/b',
      },
    });
    assert.deepEqual(projects, [
      { project_id: 'p1', repo_index: 0, base_branch: 'release/a', target_branch: 'feature/x' },
      { project_id: 'p1', repo_index: 1, base_branch: 'hotfix/b', target_branch: 'feature/x' },
    ]);
  });

  it('accepts projectSelections.repoBranches like CreateTaskModal', () => {
    const projects = buildProjectsFromSelection({
      projectIds: ['p1'],
      projectsList: [{
        id: 'p1',
        git_repos: ['https://a.git', 'https://b.git'],
      }],
      workBranch: 'feature/z',
      projectSelections: [{
        projectId: 'p1',
        repoBranches: [
          { repoIndex: 0, baseBranch: 'main' },
          { repoIndex: 1, baseBranch: 'develop' },
        ],
      }],
    });
    assert.deepEqual(projects, [
      { project_id: 'p1', repo_index: 0, base_branch: 'main', target_branch: 'feature/z' },
      { project_id: 'p1', repo_index: 1, base_branch: 'develop', target_branch: 'feature/z' },
    ]);
  });
});

describe('repoBaseBranchKey / normalizeAssignees / buildRepoBaseEditorsHtml', () => {
  it('builds stable repo key', () => {
    assert.equal(repoBaseBranchKey('p1', 0), 'p1:0');
    assert.equal(repoBaseBranchKey('p1', '2'), 'p1:2');
  });

  it('normalizes assignees to unique string ids', () => {
    assert.deepEqual(normalizeAssignees(['a', 'b', 'a', '']), ['a', 'b']);
    assert.deepEqual(normalizeAssignees(undefined), []);
  });

  it('buildRepoBaseEditorsHtml emits per-repo inputs with data attrs', () => {
    const html = buildRepoBaseEditorsHtml({
      projectIds: ['p1'],
      projectsList: [{
        id: 'p1',
        name: 'Demo',
        git_repos: ['https://gitlab.example/a/b.git', 'https://gitlab.example/a/c.git'],
        default_branch: 'develop',
      }],
      previousValues: { 'p1:0': 'main' },
      inputClass: 'form-input',
    });
    assert.match(html, /data-repo-base/);
    assert.match(html, /data-project-id="p1"/);
    assert.match(html, /data-repo-index="0"/);
    assert.match(html, /data-repo-index="1"/);
    assert.match(html, /value="main"/);
    assert.match(html, /placeholder="develop"/);
  });

  it('buildRepoBaseEditorsHtml attaches datalist so repo branch dropdown appears', () => {
    const html = buildRepoBaseEditorsHtml({
      projectIds: ['p1'],
      projectsList: [{
        id: 'p1',
        name: 'Demo',
        git_repos: ['https://gitlab.example/a/b.git'],
        default_branch: 'develop',
      }],
    });
    const listId = repoBaseDatalistId('p1', 0);
    assert.equal(listId, 'repo-base-list-p1-0');
    assert.match(html, new RegExp(`list="${listId}"`));
    assert.match(html, new RegExp(`<datalist id="${listId}"`));
    assert.match(html, /<option value="develop">/);
    assert.match(html, /<option value="main">/);
  });

  it('parseRemoteBranchNames unwraps string or {name} payloads without duplicates', () => {
    assert.deepEqual(parseRemoteBranchNames({ branches: ['main', 'develop', 'main'] }), ['main', 'develop']);
    assert.deepEqual(
      parseRemoteBranchNames([{ name: 'feat/x' }, { branch_name: 'hotfix' }, 'feat/x']),
      ['feat/x', 'hotfix'],
    );
    assert.deepEqual(parseRemoteBranchNames(null), []);
  });

  it('branchDatalistOptionsHtml always seeds develop/main then unique remotes', () => {
    const html = branchDatalistOptionsHtml(['staging', 'main']);
    assert.match(html, /value="develop"/);
    assert.match(html, /value="main"/);
    assert.match(html, /value="staging"/);
    assert.equal((html.match(/value="main"/g) || []).length, 1);
  });

  it('empty project list uses single-project empty hint, not select-then-fill copy', () => {
    assert.equal(REPO_BASE_EMPTY_HINT, '一个任务一个项目，空则用项目默认分支');
    const html = buildRepoBaseEditorsHtml({ projectIds: [] });
    assert.match(html, /一个任务一个项目，空则用项目默认分支/);
    assert.doesNotMatch(html, /选择项目后/);
    assert.doesNotMatch(html, /勾选项目/);
    assert.doesNotMatch(html, /按仓库填写/);
  });
});

describe('buildFeatureParamsFields', () => {
  it('omits fields when source empty', () => {
    assert.deepEqual(buildFeatureParamsFields({}), {});
    assert.deepEqual(buildFeatureParamsFields({ feature_params_source: 'none' }), {});
  });

  it('includes company/workspace source', () => {
    assert.deepEqual(
      buildFeatureParamsFields({ feature_params_source: 'company' }),
      { feature_params_source: 'company' }
    );
  });

  it('requires personal config id for personal source', () => {
    assert.deepEqual(buildFeatureParamsFields({ feature_params_source: 'personal' }), {});
    assert.deepEqual(
      buildFeatureParamsFields({
        feature_params_source: 'personal',
        personal_feature_params_config_id: 'cfg-1',
      }),
      {
        feature_params_source: 'personal',
        personal_feature_params_config_id: 'cfg-1',
      }
    );
  });
});

describe('validateCreateTaskForm', () => {
  it('blocks when feature_params_source missing (work-panel gate)', () => {
    const reason = validateCreateTaskForm({
      title: 't',
      workspaceId: 'ws',
      owner: 'o1',
      projectIds: ['p1'],
    });
    assert.match(reason, /智能体资源配置/);
  });

  it('blocks personal without config id', () => {
    const reason = validateCreateTaskForm({
      title: 't',
      workspaceId: 'ws',
      owner: 'o1',
      projectIds: ['p1'],
      feature_params_source: 'personal',
    });
    assert.match(reason, /智能体资源配置/);
  });

  it('passes when company source selected', () => {
    assert.equal(validateCreateTaskForm({
      title: 't',
      workspaceId: 'ws',
      owner: 'o1',
      projectIds: ['p1'],
      feature_params_source: 'company',
    }), '');
  });

  it('blocks auto_run without installed image', () => {
    const reason = validateCreateTaskForm({
      title: 't',
      workspaceId: 'ws',
      owner: 'o1',
      projectIds: ['p1'],
      feature_params_source: 'company',
      auto_run: true,
    });
    assert.match(reason, /请先选择已安装镜像/);
  });

  it('allows auto_run off without installed image', () => {
    assert.equal(validateCreateTaskForm({
      title: 't',
      workspaceId: 'ws',
      owner: 'o1',
      projectIds: ['p1'],
      feature_params_source: 'company',
      auto_run: false,
    }), '');
  });

  it('passes auto_run when installed image is selected', () => {
    assert.equal(validateCreateTaskForm({
      title: 't',
      workspaceId: 'ws',
      owner: 'o1',
      projectIds: ['p1'],
      feature_params_source: 'company',
      auto_run: true,
      container_image_id: 'img-1',
    }), '');
  });
});

describe('buildCreateTaskPayload', () => {
  it('builds work-panel aligned create-task body', () => {
    const payload = buildCreateTaskPayload({
      title: 'hello',
      description: 'desc',
      priority: 'high',
      workspaceId: 'ws1',
      owner: 'owner-1',
      assignees: ['a1', 'a1', ''],
      progress_column_id: 'col-1',
      deliverable_obj_id: 'del-1',
      container_image_id: 'img-1',
      container_image_skill_id: 'sk_abc123',
      due_date: '2026-07-23T15:01',
      auto_run: true,
      force_auto_run: false,
      feature_params_source: 'workspace',
      workBranch: 'feature/x',
      mergeTarget: 'main',
      baseBranch: 'develop',
      repoBaseBranches: { 'p1:0': 'staging' },
      projectIds: ['p1'],
      projectsList: [{
        id: 'p1',
        git_repos: ['https://r.git'],
      }],
      source: 'chrome-devtools',
    });

    assert.equal(payload.title, 'hello');
    assert.equal(payload.description, 'desc');
    assert.equal(payload.priority, 0);
    assert.equal(payload.workspace_id, 'ws1');
    assert.equal(payload.owner, 'owner-1');
    assert.deepEqual(payload.assignees, ['a1']);
    assert.equal(payload.progress_column_id, 'col-1');
    assert.equal(payload.deliverable_obj_id, 'del-1');
    assert.equal(payload.container_image_id, 'img-1');
    assert.equal(payload.container_image_skill_id, 'sk_abc123');
    assert.equal(payload.due_date, '2026-07-23T15:01');
    assert.equal(payload.auto_run, true);
    assert.equal(payload.queued_auto_run, false);
    assert.equal(payload.client_public_ip, undefined);
    assert.equal(payload.feature_params_source, 'workspace');
    assert.deepEqual(payload.branch_strategy, {
      work_branch_name: 'feature/x',
      merge_target_branch_name: 'main',
      target_branch_name: 'feature/x',
    });
    assert.deepEqual(payload.projects, [
      { project_id: 'p1', repo_index: 0, base_branch: 'staging', target_branch: 'feature/x' },
    ]);
    assert.equal(payload.source, undefined);
    assert.equal(payload.workspaceId, undefined);
  });

  it('omits container_image_skill_id without container_image_id (backend skill_id_requires_image symmetry)', () => {
    const payload = buildCreateTaskPayload({
      title: 't',
      workspaceId: 'ws1',
      owner: 'o1',
      projects: ['p1'],
      feature_params_source: 'workspace',
      container_image_skill_id: 'sk_abc123',
    });
    assert.equal(payload.container_image_id, undefined);
    assert.equal(payload.container_image_skill_id, undefined);
  });

  it('preserves existing branch_strategy when workBranch omitted', () => {
    const payload = buildCreateTaskPayload({
      title: 't',
      workspaceId: 'ws',
      owner: 'o',
      feature_params_source: 'company',
      projects: [{ project_id: 'p1', repo_index: 0, base_branch: 'main', target_branch: 'f' }],
      branch_strategy: {
        work_branch_name: 'feature/a',
        merge_target_branch_name: 'develop',
        target_branch_name: 'feature/a',
      },
    });
    assert.deepEqual(payload.branch_strategy, {
      work_branch_name: 'feature/a',
      merge_target_branch_name: 'develop',
      target_branch_name: 'feature/a',
    });
  });

  it('forwards client_public_ip when provided for auto_run SG whitelist', () => {
    const payload = buildCreateTaskPayload({
      title: 't',
      workspaceId: 'ws',
      owner: 'o',
      feature_params_source: 'none',
      auto_run: true,
      client_public_ip: '203.0.113.55',
      projects: [{ project_id: 'p1', repo_index: 0, base_branch: 'main', target_branch: 'f' }],
    });
    assert.equal(payload.client_public_ip, '203.0.113.55');
  });

  it('sets queued_auto_run only when auto_run is true', () => {
    const queued = buildCreateTaskPayload({
      title: 't',
      workspaceId: 'ws',
      owner: 'o',
      feature_params_source: 'company',
      auto_run: true,
      queued_auto_run: true,
      projects: [{ project_id: 'p1', repo_index: 0, base_branch: 'main', target_branch: 'f' }],
    });
    assert.equal(queued.queued_auto_run, true);
    const off = buildCreateTaskPayload({
      title: 't',
      workspaceId: 'ws',
      owner: 'o',
      feature_params_source: 'company',
      auto_run: false,
      queued_auto_run: true,
      projects: [{ project_id: 'p1', repo_index: 0, base_branch: 'main', target_branch: 'f' }],
    });
    assert.equal(off.queued_auto_run, undefined);
  });
});

describe('shouldEnableDescReset', () => {
  it('disables when description is empty or nullish', () => {
    assert.equal(shouldEnableDescReset(''), false);
    assert.equal(shouldEnableDescReset(null), false);
    assert.equal(shouldEnableDescReset(undefined), false);
  });

  it('enables when description has any content (including whitespace)', () => {
    assert.equal(shouldEnableDescReset('x'), true);
    assert.equal(shouldEnableDescReset(' '), true);
    assert.equal(shouldEnableDescReset('任务描述'), true);
  });
});
