'use strict';

/**
 * 网页优化页签文案（ADR-0167 后：去网址框，换成提示词下拉 + 生成按钮）。
 *
 * 生成完的状态行要把落点项目名插进去，所以中英两版的 {project} 占位符都不能漏，
 * 否则文案会原样显示花括号。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { zh, en } = require('../lib/i18n-site-pending-tabs.js');

describe('i18n-site-pending-tabs', () => {
  it('页签标题中英都叫网页优化', () => {
    assert.equal(zh.agentSuggestionsTab, '网页优化');
    assert.equal(en.agentSuggestionsTab, 'Page optimization');
  });

  it('面板内标题仍叫网页优化建议', () => {
    assert.equal(zh.agentSuggestionsPanelTitle, '网页优化建议');
    assert.equal(en.agentSuggestionsPanelTitle, 'Page optimization suggestions');
  });

  it('落点状态行中英都有 {project} 占位符', () => {
    assert.match(zh.agentSuggestionsGeneratedInto, /\{project\}/);
    assert.match(en.agentSuggestionsGeneratedInto, /\{project\}/);
    assert.match(zh.agentSuggestionsPostedExisting, /\{project\}/);
    assert.match(en.agentSuggestionsPostedExisting, /\{project\}/);
  });

  it('中文说明建在哪个项目，英文同样', () => {
    assert.match(zh.agentSuggestionsGeneratedInto, /已在「\{project\}」创建优化贴/);
    assert.match(en.agentSuggestionsGeneratedInto, /Created .*\{project\}/);
  });

  it('提示词下拉与生成按钮中英齐全', () => {
    ['agentSuggestionsPromptLabel', 'agentSuggestionsPromptDefault', 'agentSuggestionsGenerate',
      'agentSuggestionsGenerating', 'agentSuggestionsGenerateFail'].forEach((key) => {
      assert.ok(zh[key], `zh.${key} missing`);
      assert.ok(en[key], `en.${key} missing`);
    });
  });

  it('已去掉网址查询相关文案', () => {
    ['agentSuggestionsUrlPlaceholder', 'agentSuggestionsUrlLabel', 'agentSuggestionsTypedScope',
      'agentSuggestionsIncludeQuery', 'agentSuggestionsQuery',
      'agentSuggestionsInvalidUrl', 'agentSuggestionsEmptyUrl'].forEach((key) => {
      assert.equal(zh[key], undefined, `zh.${key} should be gone`);
      assert.equal(en[key], undefined, `en.${key} should be gone`);
    });
  });

  it('中英键集合一致', () => {
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  });
});
