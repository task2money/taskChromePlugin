'use strict';

/**
 * 匿名优化贴的网页报告入口（2026-11-07）：
 * 后台按本地入口拼 <站点>/try/<帖 id>/?k=<只读令牌> 并打开标签页。
 * 令牌只留在后台存储与标签页 URL 里：不回传侧栏、不进页面 DOM。
 */

const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');

function anonEntry(overrides = {}) {
  return {
    post_id: 'anon-1',
    view_token: 'tok-1',
    page_url: 'https://shop.test/p',
    expires_at: '2099-11-04T09:00:00Z',
    created_at: '2026-10-28T08:00:00Z',
    title: '把 CTA 提到首屏',
    summary: '首屏没有按钮',
    detail: '把主按钮上移',
    claim_status: 'open',
    suggestions: [{ id: 's1', title: '移动 CTA', dom_id: 'hero-cta' }],
    ...overrides,
  };
}

function loadReportStack({ entries = [anonEntry()], siteBaseUrl = 'https://www.example.test', create } = {}) {
  const local = { pa_anon_posts_v1: entries };
  const created = [];
  const sandbox = {
    console,
    URL,
    TaskPluginRuntimeConfig: { siteBaseUrl },
    chrome: {
      storage: {
        local: {
          get: async (key) => ({ [key]: local[key] }),
          set: async (items) => { Object.assign(local, items); },
        },
      },
      tabs: {
        create: async (opts) => {
          created.push(opts);
          if (typeof create === 'function') return create(opts);
          return { id: 99 };
        },
      },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  require('./helpers/txRuntime.js').installTxInSandbox(sandbox);
  for (const rel of ['lib/page-advisor-anon-posts.js', 'background/sw-page-advisor-page-trial.js']) {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, rel), 'utf8'),
      sandbox,
      { filename: path.basename(rel) },
    );
  }
  return { sandbox, created, local };
}

describe('sw-page-advisor-page-trial 报告入口', () => {
  it('按本地入口拼 /try/<id>/?k=<令牌> 并打开新标签页', async () => {
    const { sandbox, created } = loadReportStack();
    const resp = await sandbox.handleOpenPageTrialReport({ postId: 'anon-1' });
    assert.equal(resp.success, true);
    assert.equal(created.length, 1);
    assert.equal(created[0].url, 'https://www.example.test/try/anon-1/?k=tok-1');
    assert.equal(created[0].active, true);
    // 令牌只在标签页 URL 里；回包不带地址，避免侧栏再复制一份凭据。
    assert.doesNotMatch(JSON.stringify(resp), /tok-1/);
  });

  it('没有本地入口 / 未注入站点基址 / 开标签页失败：不拼地址、不抛错', async () => {
    const unknown = loadReportStack();
    const missing = await unknown.sandbox.handleOpenPageTrialReport({ postId: 'nope' });
    assert.equal(missing.success, false);
    assert.equal(unknown.created.length, 0);

    const noSite = loadReportStack({ siteBaseUrl: '' });
    const noBase = await noSite.sandbox.handleOpenPageTrialReport({ postId: 'anon-1' });
    assert.equal(noBase.success, false);
    assert.equal(noSite.created.length, 0);

    const failing = loadReportStack({ create: async () => { throw new Error('no tabs'); } });
    const failed = await failing.sandbox.handleOpenPageTrialReport({ postId: 'anon-1' });
    assert.equal(failed.success, false);
    assert.equal(failed.error, failing.sandbox.tx('paSiteReportFail'));
  });
});
