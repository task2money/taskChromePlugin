'use strict';

/**
 * 智能体建议页签文案（含 OPT-20261012-024 的「正在查看哪条网址」状态行）。
 *
 * 状态行要把查询框里的网址插进去，所以中英两版的 {url} 占位符都不能漏，
 * 否则文案会原样显示花括号。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { zh, en } = require('../lib/i18n-site-pending-tabs.js');

describe('i18n-site-pending-tabs', () => {
  it('网址状态行中英都有 {url} 占位符', () => {
    assert.match(zh.agentSuggestionsTypedScope, /\{url\}/);
    assert.match(en.agentSuggestionsTypedScope, /\{url\}/);
  });

  it('中文说明在看所填网址，英文说明切换标签不影响结果', () => {
    assert.match(zh.agentSuggestionsTypedScope, /正在查看/);
    assert.match(en.agentSuggestionsTypedScope, /^Showing /);
  });

  it('中英键集合一致', () => {
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  });
});
