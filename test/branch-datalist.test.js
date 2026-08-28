'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const BranchDatalist = require('../lib/branch-datalist.js');

function makeInput(projectId, repoIndex, listId) {
  return {
    getAttribute(name) {
      if (name === 'data-project-id') return projectId;
      if (name === 'data-repo-index') return String(repoIndex);
      if (name === 'list') return listId;
      return null;
    },
  };
}

describe('BranchDatalist.populateRepoBaseBranchDatalists', () => {
  let realDoc;
  let datalists;
  let inputs;

  beforeEach(() => {
    realDoc = globalThis.document;
    datalists = {};
    inputs = [makeInput('p1', 0, 'repo-base-list-p1-0')];
    globalThis.document = {
      getElementById: (id) => datalists[id] || null,
    };
  });

  afterEach(() => {
    globalThis.document = realDoc;
  });

  function container() {
    return {
      querySelectorAll: (sel) => (sel === '[data-repo-base][data-project-id][list]' ? inputs : []),
    };
  }

  function projects() {
    return [{ id: 'p1', git_repos: ['https://git.example/owner/repo.git'] }];
  }

  it('populates datalist with stubbed getBranches plus builtin develop/main', async () => {
    datalists['repo-base-list-p1-0'] = { innerHTML: '' };
    const calls = [];
    await BranchDatalist.populateRepoBaseBranchDatalists({
      containerEl: container(),
      projects: projects(),
      workspace: { company_id: 'co1' },
      getBranches: async (params) => {
        calls.push(params);
        return { branches: ['feature/foo', 'main'] };
      },
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      companyId: 'co1',
      projectId: 'p1',
      repoUrl: 'https://git.example/owner/repo.git',
    });

    const html = datalists['repo-base-list-p1-0'].innerHTML;
    assert.match(html, /<option value="develop"><\/option>/);
    assert.match(html, /<option value="main"><\/option>/);
    assert.match(html, /<option value="feature\/foo"><\/option>/);
    // builtin main 与远程返回的 main 去重，只出现一次
    assert.equal((html.match(/value="main"/g) || []).length, 1);
  });

  it('builtin branch returned by getBranches is de-duplicated (edge)', async () => {
    datalists['repo-base-list-p1-0'] = { innerHTML: '' };
    await BranchDatalist.populateRepoBaseBranchDatalists({
      containerEl: container(),
      projects: projects(),
      workspace: { companyId: 'co1' },
      getBranches: async () => ({ branches: ['develop'] }),
    });

    const html = datalists['repo-base-list-p1-0'].innerHTML;
    assert.equal((html.match(/value="develop"/g) || []).length, 1);
  });

  it('handles string-array branches response shape', async () => {
    datalists['repo-base-list-p1-0'] = { innerHTML: '' };
    await BranchDatalist.populateRepoBaseBranchDatalists({
      containerEl: container(),
      projects: projects(),
      workspace: { companyId: 'co1' },
      getBranches: async () => ['release/1.0'],
    });

    const html = datalists['repo-base-list-p1-0'].innerHTML;
    assert.match(html, /<option value="release\/1\.0"><\/option>/);
  });

  it('skips silently when workspace lacks companyId', async () => {
    datalists['repo-base-list-p1-0'] = { innerHTML: 'untouched' };
    let called = false;
    await BranchDatalist.populateRepoBaseBranchDatalists({
      containerEl: container(),
      projects: projects(),
      workspace: {},
      getBranches: async () => {
        called = true;
        return { branches: [] };
      },
    });
    assert.equal(called, false);
    assert.equal(datalists['repo-base-list-p1-0'].innerHTML, 'untouched');
  });

  it('logs a warning without throwing when getBranches rejects', async () => {
    datalists['repo-base-list-p1-0'] = { innerHTML: '' };
    const realWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
      await BranchDatalist.populateRepoBaseBranchDatalists({
        containerEl: container(),
        projects: projects(),
        workspace: { company_id: 'co1' },
        getBranches: async () => {
          const err = new Error('boom');
          err.traceId = 'tid-1';
          throw err;
        },
      });
    } finally {
      console.warn = realWarn;
    }
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /getBranches failed/);
    assert.equal(warnings[0][1].traceId, 'tid-1');
  });
});
