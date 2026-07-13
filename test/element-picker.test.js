'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildElementLabel,
  buildCssPath,
  validateAdjustment,
  validateScreenshotDataUrl,
  validateScreenshotUrl,
  formatElementAdjustmentBlock,
  appendElementAdjustmentToDescription,
  truncateText,
  resolveComposedElement,
  pierceSameOriginIframe,
  deepElementFromPoint,
  hitTestInRoot,
  isLikelyUaShadowHost,
  detectUaShadowOpaque,
  urlsLikelySameFrame,
  buildFramePathFromRoot,
  accumulateFrameViewportRect,
  findIframeElementByUrl,
} = require('../lib/element-picker.js');

describe('buildElementLabel', () => {
  it('builds tag#id.class from parts', () => {
    assert.equal(
      buildElementLabel({ tagName: 'BUTTON', id: 'ok', className: 'primary large' }),
      'button#ok.primary.large',
    );
  });
});

describe('buildCssPath', () => {
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
    const r = pierceSameOriginIframe(iframe, 15, 20);
    assert.equal(r.el, inner);
    assert.equal(r.closedShadow, false);
  });
});

describe('deepElementFromPoint / hitTestInRoot', () => {
  it('pierces closed shadow via injected opener', () => {
    const inner = {
      nodeType: 1,
      tagName: 'SPAN',
      getBoundingClientRect() {
        return { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 };
      },
    };
    const host = { nodeType: 1, tagName: 'DIV', id: 'host' };
    const shadow = {
      mode: 'closed',
      querySelectorAll() {
        return [inner];
      },
    };
    const doc = {
      elementFromPoint() {
        return host;
      },
    };
    const r = deepElementFromPoint(doc, 5, 5, {
      openShadowRoot(el) {
        return el === host ? shadow : null;
      },
    });
    assert.equal(r.el, inner);
    assert.equal(r.closedShadow, true);
  });

  it('hitTestInRoot picks smallest containing element', () => {
    const big = {
      getBoundingClientRect() {
        return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
      },
    };
    const small = {
      getBoundingClientRect() {
        return { left: 10, top: 10, right: 20, bottom: 20, width: 10, height: 10 };
      },
    };
    const root = {
      querySelectorAll() {
        return [big, small];
      },
    };
    assert.equal(hitTestInRoot(root, 15, 15), small);
  });
});

describe('validateAdjustment', () => {
  it('rejects empty adjustment', () => {
    assert.equal(validateAdjustment(''), '请填写希望对该元素做什么调整');
  });
});

describe('validateScreenshotDataUrl / validateScreenshotUrl', () => {
  it('rejects non-image data url', () => {
    assert.match(validateScreenshotDataUrl('data:text/plain;base64,YQ=='), /截图格式无效/);
  });

  it('rejects data url as screenshotUrl', () => {
    assert.match(validateScreenshotUrl('data:image/jpeg;base64,abc'), /http/);
  });

  it('accepts https screenshot url', () => {
    assert.equal(validateScreenshotUrl('https://cdn.example/a.jpg'), null);
  });
});

describe('formatElementAdjustmentBlock', () => {
  it('prefers uploaded screenshotUrl over data url', () => {
    const block = formatElementAdjustmentBlock({
      pageUrl: 'https://a.test/',
      element: {
        label: 'span.x',
        cssPath: 'div#host >>> span.x',
        inClosedShadow: true,
        crossOriginIframe: true,
      },
      adjustment: '改色',
      screenshotUrl: 'https://cdn.example/shot.jpg',
      screenshotDataUrl: 'data:image/jpeg;base64,should-not-appear',
    });
    assert.match(block, /closed Shadow DOM/);
    assert.match(block, /跨域 iframe/);
    assert.match(block, /!\[[^\]]*\]\(https:\/\/cdn\.example\/shot\.jpg\)/);
    assert.doesNotMatch(block, /should-not-appear/);
  });

  it('annotates UA Shadow opaque host', () => {
    const block = formatElementAdjustmentBlock({
      pageUrl: 'https://a.test/',
      element: {
        label: 'video',
        uaShadowOpaque: true,
        frameNestingDepth: 2,
      },
      adjustment: '加大控件',
    });
    assert.match(block, /UA Shadow/);
    assert.match(block, /iframe 嵌套深度/);
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

describe('UA Shadow helpers', () => {
  it('detects video as UA shadow host', () => {
    assert.equal(isLikelyUaShadowHost({ nodeType: 1, tagName: 'VIDEO' }), true);
  });

  it('marks opaque when opener returns null', () => {
    const el = { nodeType: 1, tagName: 'VIDEO' };
    const r = detectUaShadowOpaque(el, { openShadowRoot: () => null });
    assert.equal(r.uaShadowHost, true);
    assert.equal(r.uaShadowOpaque, true);
  });
});

describe('frame path / viewport accumulate', () => {
  it('builds path from leaf to near-top', () => {
    const frames = [
      { frameId: 0, parentFrameId: -1, url: 'https://top/' },
      { frameId: 1, parentFrameId: 0, url: 'https://a/' },
      { frameId: 2, parentFrameId: 1, url: 'https://b/' },
    ];
    const path = buildFramePathFromRoot(frames, 2);
    assert.deepEqual(path.map((p) => p.frameId), [1, 2]);
    assert.equal(path[1].url, 'https://b/');
  });

  it('accumulates nested iframe offsets', () => {
    const r = accumulateFrameViewportRect(
      { left: 5, top: 6, width: 10, height: 20 },
      [{ left: 100, top: 200 }, { left: 3, top: 4 }],
    );
    assert.equal(r.left, 108);
    assert.equal(r.top, 210);
    assert.equal(r.width, 10);
  });

  it('matches iframe urls ignoring trailing slash', () => {
    assert.equal(
      urlsLikelySameFrame('https://x.test/app', 'https://x.test/app/'),
      true,
    );
  });

  it('findIframeElementByUrl matches src', () => {
    const iframe = { src: 'https://x.test/embed', tagName: 'IFRAME' };
    const doc = {
      querySelectorAll() {
        return [iframe];
      },
    };
    assert.equal(findIframeElementByUrl(doc, 'https://x.test/embed/'), iframe);
  });
});

describe('appendElementAdjustmentToDescription', () => {
  it('appends after existing description', () => {
    const next = appendElementAdjustmentToDescription('已有描述', {
      pageUrl: 'https://a.test/',
      element: { label: 'a.link' },
      adjustment: '改链接颜色',
    });
    assert.ok(next.startsWith('已有描述\n\n---'));
  });
});

describe('truncateText', () => {
  it('truncates long text with ellipsis', () => {
    const out = truncateText('a'.repeat(200), 10);
    assert.equal(out.length, 11);
    assert.ok(out.endsWith('…'));
  });
});
