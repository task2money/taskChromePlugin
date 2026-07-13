'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildElementLabel,
  buildCssPath,
  validateAdjustment,
  validateScreenshotDataUrl,
  formatElementAdjustmentBlock,
  appendElementAdjustmentToDescription,
  truncateText,
  resolveComposedElement,
  pierceSameOriginIframe,
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

  it('inserts >>> across shadow boundary', () => {
    const path = buildCssPath([
      { tagName: 'div', id: 'host', nthOfType: 1 },
      { tagName: 'button', className: 'inner', nthOfType: 1, crossedShadowFromParent: true },
    ]);
    assert.equal(path, 'div#host >>> button.inner');
  });
});

describe('resolveComposedElement', () => {
  it('returns deepest non-excluded element from composedPath', () => {
    const host = { nodeType: 1, id: 'host' };
    const inner = { nodeType: 1, id: 'inner' };
    const plugin = { nodeType: 1, id: 'taskplugin-float-root' };
    const el = resolveComposedElement(
      { composedPath: () => [plugin, inner, host] },
      (n) => n.id === 'taskplugin-float-root',
    );
    assert.equal(el, inner);
  });
});

describe('pierceSameOriginIframe', () => {
  it('throws CROSS_ORIGIN_IFRAME when contentDocument inaccessible', () => {
    const iframe = {
      tagName: 'IFRAME',
      get contentDocument() {
        throw new Error('Blocked a frame');
      },
      getBoundingClientRect() {
        return { left: 0, top: 0 };
      },
    };
    assert.throws(
      () => pierceSameOriginIframe(iframe, 10, 10),
      (err) => err.code === 'CROSS_ORIGIN_IFRAME',
    );
  });

  it('returns inner element for same-origin iframe mock', () => {
    const inner = { nodeType: 1, tagName: 'BUTTON' };
    const iframe = {
      tagName: 'IFRAME',
      contentDocument: {
        elementFromPoint() {
          return inner;
        },
      },
      getBoundingClientRect() {
        return { left: 5, top: 5 };
      },
    };
    assert.equal(pierceSameOriginIframe(iframe, 15, 20), inner);
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

describe('validateScreenshotDataUrl', () => {
  it('allows empty (optional)', () => {
    assert.equal(validateScreenshotDataUrl(''), null);
    assert.equal(validateScreenshotDataUrl(undefined), null);
  });

  it('rejects non-image data url', () => {
    assert.match(validateScreenshotDataUrl('data:text/plain;base64,YQ=='), /截图格式无效/);
  });

  it('accepts jpeg data url', () => {
    assert.equal(validateScreenshotDataUrl('data:image/jpeg;base64,/9j/4AAQ'), null);
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

  it('includes shadow/iframe context and screenshot markdown', () => {
    const block = formatElementAdjustmentBlock({
      pageUrl: 'https://a.test/',
      element: {
        label: 'span.x',
        cssPath: 'div#host >>> span.x',
        inShadow: true,
        inIframe: true,
      },
      adjustment: '改色',
      screenshotDataUrl: 'data:image/jpeg;base64,abc',
    });
    assert.match(block, /Shadow DOM/);
    assert.match(block, /同源 iframe/);
    assert.match(block, /!\[[^\]]*\]\(data:image\/jpeg;base64,abc\)/);
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
