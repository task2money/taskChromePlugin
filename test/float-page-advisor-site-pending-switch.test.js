'use strict';

/**
 * 点开另一帖的建议时，页面确实把卡片区换成那一帖（OPT-20261012-020）。
 *
 * 背景：`showActiveSitePendingPost` / `handleSelectAgentSuggestionPost` 的切换过程
 * 写在 content script 里，提交门禁只跑过标签 HTML 与每帖锚点重绑的单测，
 * 没有真的加载这段脚本点一次。标签文案对了不代表点下去真的换了当前帖。
 *
 * 本用例在 vm 里加载 content/float-page-advisor-site-pending.js（连同真实的
 * lib/page-advisor-site-pending.js），喂入两条各带建议的帖子，再按侧边栏选择
 * 点第二帖：断言画到页面上的建议只剩第二帖的 id，且当前帖 id 跟着换。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'content', 'float-page-advisor-site-pending.js'), 'utf8');

function makeDocument() {
  const removed = [];
  return {
    removed,
    getElementById(id) {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function loadSitePending() {
  const shown = [];
  const document = makeDocument();
  const context = {
    console: { info() {}, warn() {}, error() {}, log() {} },
    document,
    location: { pathname: '/', href: 'https://example.com/' },
    chrome: { runtime: { sendMessage() {}, lastError: null } },
    // 页面上真正画建议的那一步；本用例只关心它被喂了哪一帖的建议。
    showPageAdvisorSuggestions(payload) {
      shown.push(payload);
    },
  };
  vm.createContext(context);
  // 真实的分帖选择逻辑，不是替身：切换是否落到正确帖子取决于它。
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'lib', 'page-advisor-site-pending.js'), 'utf8'),
    context,
  );
  vm.runInContext(SRC, context);
  return { context, shown };
}

function postWith(id, title, suggestionIds) {
  return {
    id,
    tenant_id: 't1',
    title,
    summary: `${title} 的摘要`,
    suggestions: suggestionIds.map((sid) => ({
      id: sid,
      title: `${sid} 标题`,
      detail: `${sid} 详情`,
    })),
  };
}

describe('site pending post switching', () => {
  it('shows only the selected post suggestions and moves the active post id', () => {
    const { context, shown } = loadSitePending();
    const first = postWith('post-1', '第一帖', ['sug-a', 'sug-b']);
    const second = postWith('post-2', '第二帖', ['sug-c']);

    context.handleSelectAgentSuggestionPost({ item: first, postId: first.id });
    assert.equal(shown.length, 1);
    assert.deepEqual(
      Array.from(shown[0].suggestions, (s) => s.id),
      ['sug-a', 'sug-b'],
    );

    context.handleSelectAgentSuggestionPost({ item: second, postId: second.id });
    assert.equal(shown.length, 2, '选第二帖应再画一次卡片');
    assert.deepEqual(
      Array.from(shown[1].suggestions, (s) => s.id),
      ['sug-c'],
      '卡片区应只剩第二帖的建议',
    );
    assert.equal(context.pageAdvisorSitePendingActiveId, second.id);
    assert.deepEqual(
      Array.from(context.pageAdvisorSitePendingPosts, (p) => p.id),
      [first.id, second.id],
    );
  });

  it('conceals the overlay instead of drawing when the selected post has no suggestions', () => {
    const { context, shown } = loadSitePending();
    const first = postWith('post-1', '第一帖', ['sug-a']);
    const empty = postWith('post-2', '空帖', []);

    context.handleSelectAgentSuggestionPost({ item: first, postId: first.id });
    assert.equal(shown.length, 1);

    // 选中的帖子没有可回绑的建议：不画卡片，收起浮层，并清掉当前帖。
    context.handleSelectAgentSuggestionPost({ item: empty, postId: empty.id });
    assert.equal(shown.length, 1, '没有建议的帖子不得再画卡片');
    assert.equal(context.pageAdvisorSitePendingAnchored, false);
    assert.equal(context.pageAdvisorSitePendingActiveId, '');
  });
});
