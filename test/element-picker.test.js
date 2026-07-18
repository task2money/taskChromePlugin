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
  collectContiguousSiblings,
  buildSiblingRangeCssPath,
  snapshotSiblingRange,
  unionClientRects,
  snapshotElement,
} = require('../lib/element-picker.js');

/** 构造同父兄弟 mock（供兄弟区间单测） */
function makeSiblingList(tags, { parentId = 'list', parentTag = 'UL', itemClass = 'item' } = {}) {
  const html = {
    nodeType: 1,
    tagName: 'HTML',
    id: '',
    className: '',
    parentElement: null,
    previousElementSibling: null,
    nextElementSibling: null,
  };
  const body = {
    nodeType: 1,
    tagName: 'BODY',
    id: '',
    className: '',
    parentElement: html,
    previousElementSibling: null,
    nextElementSibling: null,
  };
  const parent = {
    nodeType: 1,
    tagName: parentTag,
    id: parentId,
    className: 'list',
    parentElement: body,
    previousElementSibling: null,
    nextElementSibling: null,
    children: [],
    firstElementChild: null,
  };
  const els = tags.map((tag, i) => {
    const t = String(tag).toUpperCase();
    return {
      nodeType: 1,
      tagName: t,
      id: '',
      className: itemClass,
      parentElement: parent,
      textContent: `item-${i + 1}`,
      outerHTML: `<${t.toLowerCase()} class="${itemClass}">item-${i + 1}</${t.toLowerCase()}>`,
      previousElementSibling: null,
      nextElementSibling: null,
      getAttribute(name) {
        if (name === 'class') return itemClass;
        return null;
      },
    };
  });
  for (let i = 0; i < els.length; i++) {
    els[i].previousElementSibling = i > 0 ? els[i - 1] : null;
    els[i].nextElementSibling = i < els.length - 1 ? els[i + 1] : null;
  }
  parent.children = els;
  parent.firstElementChild = els[0] || null;
  return { parent, els };
}

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

describe('sibling range pick', () => {
  it('collectContiguousSiblings returns ordered slice including endpoints', () => {
    const { els } = makeSiblingList(['li', 'li', 'li', 'li']);
    const range = collectContiguousSiblings(els[3], els[1]);
    assert.equal(range.length, 3);
    assert.equal(range[0], els[1]);
    assert.equal(range[2], els[3]);
  });

  it('collectContiguousSiblings returns null for different parents', () => {
    const a = makeSiblingList(['li', 'li']);
    const b = makeSiblingList(['li', 'li'], { parentId: 'other' });
    assert.equal(collectContiguousSiblings(a.els[0], b.els[0]), null);
  });

  it('buildSiblingRangeCssPath uses nth-of-type for same-tag siblings', () => {
    const { els } = makeSiblingList(['li', 'li', 'li', 'li']);
    const path = buildSiblingRangeCssPath(els.slice(1, 4));
    assert.match(path, /ul#list/);
    assert.match(path, /li\.item:nth-of-type\(n\+2\):nth-of-type\(-n\+4\)/);
  });

  it('buildSiblingRangeCssPath falls back to nth-child for mixed tags', () => {
    const { els } = makeSiblingList(['li', 'div', 'li']);
    const path = buildSiblingRangeCssPath(els.slice(0, 2));
    assert.match(path, /:nth-child\(n\+1\):nth-child\(-n\+2\)/);
  });

  it('snapshotSiblingRange marks multi and siblingRange metadata', () => {
    const { els } = makeSiblingList(['li', 'li', 'li']);
    const snap = snapshotSiblingRange(els.slice(0, 3));
    assert.equal(snap.multi, true);
    assert.equal(snap.siblingCount, 3);
    assert.match(snap.label, /×3/);
    assert.equal(snap.siblingRange.startChildIndex, 1);
    assert.equal(snap.siblingRange.endChildIndex, 3);
    assert.equal(snap.siblings.length, 3);
  });

  it('snapshotSiblingRange with one element matches snapshotElement label', () => {
    const { els } = makeSiblingList(['li', 'li']);
    const multi = snapshotSiblingRange([els[0]]);
    const single = snapshotElement(els[0]);
    assert.equal(multi.label, single.label);
    assert.equal(multi.cssPath, single.cssPath);
    assert.equal(multi.multi, undefined);
  });

  it('formatElementAdjustmentBlock includes sibling range line for multi', () => {
    const block = formatElementAdjustmentBlock({
      pageUrl: 'https://a.test/',
      element: {
        multi: true,
        label: 'li.item ×3',
        cssPath: 'ul#list > li.item:nth-of-type(n+1):nth-of-type(-n+3)',
        siblingRange: { startChildIndex: 1, endChildIndex: 3, count: 3 },
        visibleText: 'a | b | c',
      },
      adjustment: '统一改样式',
    });
    assert.match(block, /li\.item ×3/);
    assert.match(block, /兄弟区间.*第 1–3 项（共 3 个）/);
    assert.match(block, /统一改样式/);
  });

  it('unionClientRects returns bounding union', () => {
    const u = unionClientRects([
      { left: 10, top: 20, width: 30, height: 10 },
      { left: 15, top: 40, width: 40, height: 20 },
    ]);
    assert.equal(u.left, 10);
    assert.equal(u.top, 20);
    assert.equal(u.width, 45);
    assert.equal(u.height, 40);
  });
});

describe('truncateText', () => {
  it('truncates long text with ellipsis', () => {
    const out = truncateText('a'.repeat(200), 10);
    assert.equal(out.length, 11);
    assert.ok(out.endsWith('…'));
  });
});
