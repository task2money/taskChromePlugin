'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GitId = require('../lib/create-task-git-identity.js');
const { validateCreateTaskForm, buildCreateTaskPayload, buildRepoBaseEditorsHtml } = require('../lib/create-task-payload.js');

describe('CreateTaskGitIdentity gate', () => {
  it('requires identity only when auto_run is on', () => {
    assert.equal(GitId.shouldRequire(true), true);
    assert.equal(GitId.shouldRequire(false), false);
    assert.equal(GitId.validate(false, [], ['https://git.example/a.git']), '');
  });

  it('blocks auto_run when a linked repo has no git identity', () => {
    const err = GitId.validate(
      true,
      [{ repo_url: 'https://git.example/a.git', git_identity_id: 'gid-1' }],
      ['https://git.example/a.git', 'https://git.example/b.git'],
    );
    assert.match(err, /Git 提交身份/);
    assert.match(err, /https:\/\/git\.example\/b\.git/);
  });

  it('passes auto_run when every required repo has git_identity_id', () => {
    assert.equal(GitId.validate(
      true,
      [
        { repo_url: 'https://git.example/a.git', git_identity_id: 'gid-1' },
        { repo_url: 'https://git.example/b.git', git_identity_id: 'gid-2' },
      ],
      ['https://git.example/a.git', 'https://git.example/b.git'],
    ), '');
  });

  it('omits payload when auto_run is off', () => {
    assert.equal(GitId.buildPayload(false, [
      { repo_url: 'https://git.example/a.git', git_identity_id: 'gid-1' },
    ]), undefined);
  });

  it('builds git-identities request path with company_id', () => {
    assert.equal(
      GitId.gitIdentitiesRequestPath('u1', 'co1'),
      '/api/git-identities/user/u1/?company_id=co1',
    );
  });
});

describe('CreateTaskGitIdentity HTML / DOM', () => {
  it('emits identity select only when gitIdentity.enabled', () => {
    const args = {
      projectIds: ['p1'],
      projectsList: [{ id: 'p1', git_repos: ['https://git.example/a.git'] }],
      identities: [{ id: 'gid-1', git_user_name: 'Ann', git_user_email: 'a@x.com', is_default: true }],
      settingsHref: '/tenant/t1/profile/git-identities/',
    };
    const off = GitId.buildEditorsHtml({ ...args, enabled: false });
    assert.equal(off.includes('data-git-identity'), false);

    const on = GitId.buildEditorsHtml({ ...args, enabled: true });
    assert.match(on, /data-testid="create-task-git-identity-section"/);
    assert.match(on, /data-git-identity="1"/);
    assert.match(on, /Git 提交身份/);
    assert.match(on, /gid-1/);
    assert.match(on, /href="\/tenant\/t1\/profile\/git-identities\/"/);
    assert.match(on, /去账号中心管理 Git 提交身份/);
  });

  it('settings link uses panel accent color so it is readable on dark UI', () => {
    const html = GitId.buildSelectHtml({
      repoUrl: 'https://git.example/a.git',
      identities: [{ id: 'gid-1', git_user_name: 'Ann', git_user_email: 'a@x.com' }],
      settingsHref: '/tenant/t1/profile/git-identities/',
    });
    assert.match(html, /data-git-identity-settings="1"/);
    assert.match(html, /color:#89b4fa/);
    assert.doesNotMatch(html, /color:#0000EE/i);
  });

  it('dark UI stylesheets set readable link color (not UA blue)', () => {
    const root = path.join(__dirname, '..');
    const panelCss = fs.readFileSync(path.join(root, 'panel/panel.css'), 'utf8');
    const popupCss = fs.readFileSync(path.join(root, 'popup/popup.css'), 'utf8');
    const contentFormCss = fs.readFileSync(path.join(root, 'content/content-form.css'), 'utf8');
    const manifest = fs.readFileSync(path.join(root, 'manifest.json'), 'utf8');
    assert.match(panelCss, /a \{ color: #89b4fa; \}/);
    assert.match(popupCss, /a \{ color: #89b4fa; \}/);
    assert.match(contentFormCss, /#taskplugin-float-panel a \{/);
    assert.match(contentFormCss, /color: #89b4fa !important;/);
    assert.match(manifest, /content\/content-form\.css/);
  });

  it('keeps identity editors out of repo-base HTML', () => {
    const html = buildRepoBaseEditorsHtml({
      projectIds: ['p1'],
      projectsList: [{ id: 'p1', git_repos: ['https://git.example/a.git'] }],
    });
    assert.equal(html.includes('data-git-identity'), false);
    assert.equal(html.includes('Git 提交身份'), false);
  });

  it('reads selected identities from a querySelectorAll root', () => {
    const el = {
      getAttribute(name) {
        return name === 'data-repo-url' ? 'https://git.example/a.git' : '';
      },
      value: 'gid-1',
    };
    const root = {
      querySelectorAll(sel) {
        return String(sel).includes('data-git-identity') ? [el] : [];
      },
    };
    assert.deepEqual(GitId.readRepoIdentitiesFromRoot(root), [
      { repo_url: 'https://git.example/a.git', git_identity_id: 'gid-1' },
    ]);
  });
});

describe('create-task-payload identity wiring', () => {
  const baseForm = {
    title: 't',
    workspaceId: 'ws',
    owner: 'o1',
    projectIds: ['p1'],
    projectsList: [{ id: 'p1', git_repos: ['https://git.example/a.git'] }],
    feature_params_source: 'company',
    container_image_id: 'img-1',
  };

  it('validateCreateTaskForm ignores missing identity when auto_run is off', () => {
    assert.equal(validateCreateTaskForm({ ...baseForm, auto_run: false }), '');
  });

  it('validateCreateTaskForm blocks auto_run without identity', () => {
    assert.match(validateCreateTaskForm({ ...baseForm, auto_run: true, repo_identities: [] }), /Git 提交身份/);
  });

  it('buildCreateTaskPayload attaches repo_identities only when auto_run', () => {
    const off = buildCreateTaskPayload({
      ...baseForm,
      auto_run: false,
      repo_identities: [{ repo_url: 'https://git.example/a.git', git_identity_id: 'gid-1' }],
    });
    assert.equal(off.repo_identities, undefined);

    const on = buildCreateTaskPayload({
      ...baseForm,
      auto_run: true,
      repo_identities: [{ repo_url: 'https://git.example/a.git', git_identity_id: 'gid-1' }],
    });
    assert.deepEqual(on.repo_identities, [
      { repo_url: 'https://git.example/a.git', git_identity_id: 'gid-1' },
    ]);
  });
});
