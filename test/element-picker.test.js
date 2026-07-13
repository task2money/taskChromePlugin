'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildElementLabel,
  buildCssPath,
  validateAdjustment,
  formatElementAdjustmentBlock,
  appendElementAdjustmentToDescription,
  truncateText,
} = require('../lib/element-picker.js');

describe('buildElementLabel', () => {
  it('builds tag#id.class from parts', () => {
    assert.equal(
      buildElementLabel({ tagName: 'BUTTON', id: 'ok', className: 'primary large' }),
      'button#ok.primary.large',
    );
  });

  it('works with class array and missing id', () => {
    assert.equal(
      buildElementLabel({ tagName: 'div', className: ['card', 'active'] }),
      'div.card.active',
    );
  });
});

describe('buildCssPath', () => {
  it('joins ancestor chain with nth-of-type when needed', () => {
    const path = buildCssPath([
      { tagName: 'body', nthOfType: 1 },
      { tagName: 'div', className: 'main', nthOfType: 1 },
      { tagName: 'button', id: 'submit', nthOfType: 2 },
    ]);
    assert.equal(path, 'body > div.main > button#submit');
  });

  it('adds nth-of-type when index > 1 and no id', () => {
    const path = buildCssPath([
      { tagName: 'ul', nthOfType: 1 },
      { tagName: 'li', className: 'item', nthOfType: 3 },
    ]);
    assert.equal(path, 'ul > li.item:nth-of-type(3)');
  });
});

describe('validateAdjustment', () => {
  it('rejects empty adjustment', () => {
    assert.equal(validateAdjustment(''), '请填写希望对该元素做什么调整');
    assert.equal(validateAdjustment('   '), '请填写希望对该元素做什么调整');
  });

  it('accepts non-empty adjustment', () => {
    assert.equal(validateAdjustment('把按钮改成红色'), null);
  });
});

describe('formatElementAdjustmentBlock', () => {
  it('includes page url, element, and adjustment', () => {
    const block = formatElementAdjustmentBlock({
      pageUrl: 'https://example.com/app',
      pageTitle: 'Demo',
      element: {
        label: 'button#ok.primary',
        cssPath: 'body > button#ok',
        visibleText: '确定',
      },
      adjustment: '放大字号',
    });
    assert.match(block, /\*\*页面链接\*\*: https:\/\/example\.com\/app/);
    assert.match(block, /\*\*页面标题\*\*: Demo/);
    assert.match(block, /\*\*元素\*\*: `button#ok\.primary`/);
    assert.match(block, /\*\*选择器\*\*: `body > button#ok`/);
    assert.match(block, /\*\*可见文本\*\*: "确定"/);
    assert.match(block, /\*\*调整期望\*\*: 放大字号/);
  });

  it('throws when pageUrl missing', () => {
    assert.throws(
      () => formatElementAdjustmentBlock({
        pageUrl: '',
        element: { label: 'div' },
        adjustment: 'x',
      }),
      /pageUrl/,
    );
  });
});

describe('appendElementAdjustmentToDescription', () => {
  it('appends after existing description', () => {
    const next = appendElementAdjustmentToDescription('已有描述', {
      pageUrl: 'https://a.test/',
      element: { label: 'a.link', visibleText: '[敏感输入已省略]' },
      adjustment: '改链接颜色',
    });
    assert.ok(next.startsWith('已有描述\n\n---'));
    assert.match(next, /敏感输入已省略/);
    assert.match(next, /改链接颜色/);
  });

  it('returns only block when description empty', () => {
    const next = appendElementAdjustmentToDescription('', {
      pageUrl: 'https://a.test/',
      element: { label: 'span' },
      adjustment: '隐藏',
    });
    assert.ok(next.startsWith('---'));
    assert.doesNotMatch(next, /^\n/);
  });
});

describe('truncateText', () => {
  it('truncates long text with ellipsis', () => {
    const long = 'a'.repeat(200);
    const out = truncateText(long, 10);
    assert.equal(out.length, 11);
    assert.ok(out.endsWith('…'));
  });
});
