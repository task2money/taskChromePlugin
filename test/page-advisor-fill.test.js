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

  it('formats markdown block with source url and rich anchors', () => {
    const block = formatSuggestionsBlock(
      orderSelectedSuggestions(SUGGESTIONS, ['s1', 's2']),
      'https://ex.com',
    );
    assert.match(block, /^## 页面优化建议（Alt\+Z）/);
    assert.match(block, /- \*\*调整期望\*\*: 对比度：提高按钮对比度/);
    assert.match(block, /- \*\*调整期望\*\*: 加载：减少首屏 JS/);
    assert.match(block, /来源页: https:\/\/ex\.com/);
  });

  it('appends to existing description without wiping it', () => {
    const next = appendSuggestionsToDescription(
      '已有描述',
      SUGGESTIONS,
      ['s2'],
      'https://ex.com/p',
    );
    assert.ok(next.startsWith('已有描述\n\n## 页面优化建议（Alt+Z）'));
    assert.match(next, /- \*\*调整期望\*\*: 加载：减少首屏 JS/);
  });

  it('empty selection leaves description unchanged', () => {
    assert.equal(
      appendSuggestionsToDescription('keep', SUGGESTIONS, []),
      'keep',
    );
  });

  it('emits element/selector/visible text/HTML/expectation like element-picker', () => {
    const block = formatSuggestionsBlock([
      {
        id: 's1',
        title: '对比度',
        detail: '提高按钮对比度',
        target_nid: 'n1',
        anchor_text: '提交',
        label: 'button#submit.btn-primary',
        tag: 'button',
        dom_id: 'submit',
        testid: 'submit-btn',
        landmark: 'main > h1「标题」',
        css_path: 'main > form > button#submit.btn-primary',
        visible_text: '提交',
        html_snippet: '<button id="submit" class="btn-primary">提交</button>',
        ancestor_nids: ['n0'],
      },
      {
        id: 's2',
        title: '文案',
        detail: '改按钮文字',
        target_nid: 'n1',
        anchor_text: '提交',
        label: 'button#submit.btn-primary',
        tag: 'button',
        dom_id: 'submit',
        css_path: 'main > form > button#submit.btn-primary',
        visible_text: '提交',
      },
    ], 'https://ex.com');
    assert.match(block, /不要执行一条后重新抓页面/);
    assert.match(block, /- \*\*元素\*\*: `button#submit\.btn-primary`/);
    assert.match(block, /- \*\*选择器\*\*: `main > form > button#submit\.btn-primary`/);
    assert.match(block, /- \*\*可见文本\*\*: "提交"/);
    assert.match(block, /- \*\*HTML 片段\*\*: `<button id="submit" class="btn-primary">提交<\/button>`/);
    assert.match(block, /- \*\*调整期望\*\*: 对比度：提高按钮对比度/);
    assert.match(block, /同目标: 与「文案」/);
    assert.match(block, /同目标: 与「对比度」/);
    assert.doesNotMatch(block, /锚点: button/);
    assert.doesNotMatch(block, /路径\(辅助/);
  });

  it('copies the formatted block and still reports failure without throwing', async () => {
    const { copySuggestionsBlock, fillSuccessText } = require('../lib/page-advisor-fill.js');
    const block = formatSuggestionsBlock(
      orderSelectedSuggestions(SUGGESTIONS, ['s1']),
      'https://ex.com',
    );
    let written = '';
    const ok = await copySuggestionsBlock(block, async (text) => {
      written = text;
    });
    assert.equal(ok, true);
    assert.equal(written, block);
    assert.match(fillSuccessText('one', true, null), /并已复制到剪贴板/);
    const failed = await copySuggestionsBlock(block, async () => {
      throw new Error('denied');
    });
    assert.equal(failed, false);
    assert.doesNotMatch(fillSuccessText('one', false, null), /剪贴板/);
  });

  it('fill helpers never reference createTask', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../lib/page-advisor-fill.js'),
      'utf8',
    );
    assert.doesNotMatch(src, /createTask/);
  });
});
