'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  orderSelectedSuggestions,
  formatSuggestionsBlock,
  appendSuggestionsToDescription,
} = require('../lib/page-advisor-fill.js');

const SUGGESTIONS = [
  { id: 's1', title: '对比度', summary: '短', detail: '提高按钮对比度' },
  { id: 's2', title: '加载', summary: '短', detail: '减少首屏 JS' },
  { id: 's3', title: '无障碍', summary: '短', detail: '补 alt' },
];

describe('page-advisor-fill', () => {
  it('orders by selectedIds sequence (not original list order)', () => {
    const ordered = orderSelectedSuggestions(SUGGESTIONS, ['s3', 's1']);
    assert.deepEqual(ordered.map((s) => s.id), ['s3', 's1']);
  });

  it('formats markdown block with source url', () => {
    const block = formatSuggestionsBlock(
      orderSelectedSuggestions(SUGGESTIONS, ['s1', 's2']),
      'https://ex.com',
    );
    assert.match(block, /^## 页面优化建议（Alt\+E）/);
    assert.match(block, /- \[对比度\] 提高按钮对比度/);
    assert.match(block, /- \[加载\] 减少首屏 JS/);
    assert.match(block, /来源页: https:\/\/ex\.com/);
  });

  it('appends to existing description without wiping it', () => {
    const next = appendSuggestionsToDescription(
      '已有描述',
      SUGGESTIONS,
      ['s2'],
      'https://ex.com/p',
    );
    assert.ok(next.startsWith('已有描述\n\n## 页面优化建议（Alt+E）'));
    assert.match(next, /- \[加载\] 减少首屏 JS/);
  });

  it('empty selection leaves description unchanged', () => {
    assert.equal(
      appendSuggestionsToDescription('keep', SUGGESTIONS, []),
      'keep',
    );
  });

  it('fill helpers never reference createTask', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../lib/page-advisor-fill.js'),
      'utf8',
    );
    assert.doesNotMatch(src, /createTask/);
  });
});
