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
  toggleDisjointSelection,
  snapshotDisjointSelection,
  unionClientRects,
  snapshotElement,
  prefixCssPathWithFrames,
  applyFramePrefixesToSnapshot,
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

describe('disjoint multi pick', () => {
  it('toggleDisjointSelection appends then removes in click order', () => {
    const { els } = makeSiblingList(['div', 'span', 'p']);
    let sel = [];
    sel = toggleDisjointSelection(sel, els[0]);
    sel = toggleDisjointSelection(sel, els[2]);
    sel = toggleDisjointSelection(sel, els[1]);
    assert.deepEqual(sel.map((e) => e.tagName), ['DIV', 'P', 'SPAN']);
    sel = toggleDisjointSelection(sel, els[2]);
    assert.deepEqual(sel.map((e) => e.tagName), ['DIV', 'SPAN']);
  });

  it('snapshotDisjointSelection marks selectionKind and preserves click order', () => {
    const { els } = makeSiblingList(['div', 'span', 'p']);
    const snap = snapshotDisjointSelection([els[2], els[0]]);
    assert.equal(snap.multi, true);
    assert.equal(snap.selectionKind, 'disjoint');
    assert.equal(snap.label, '多选 ×2');
    assert.equal(snap.elements.length, 2);
    assert.equal(snap.elements[0].tagName, 'p');
    assert.equal(snap.elements[1].tagName, 'div');
  });

  it('snapshotDisjointSelection with one element matches snapshotElement', () => {
    const { els } = makeSiblingList(['div', 'span']);
    const multi = snapshotDisjointSelection([els[0]]);
    const single = snapshotElement(els[0]);
    assert.equal(multi.label, single.label);
    assert.equal(multi.cssPath, single.cssPath);
    assert.equal(multi.selectionKind, undefined);
  });

  it('formatElementAdjustmentBlock lists disjoint elements with shared adjustment', () => {
    const block = formatElementAdjustmentBlock({
      pageUrl: 'https://a.test/',
      element: {
        multi: true,
        selectionKind: 'disjoint',
        label: '多选 ×2',
        visibleText: 'Save | Help',
        cssPath: '',
        elements: [
          { label: 'button.save', cssPath: 'button.save', visibleText: 'Save' },
          { label: 'a.help', cssPath: 'footer > a.help', visibleText: 'Help' },
        ],
      },
      adjustment: '两个入口都要更明显',
    });
    assert.match(block, /选择.*多选 ×2/);
    assert.match(block, /元素 1.*button\.save/);
    assert.match(block, /选择器 1.*button\.save/);
    assert.match(block, /可见文本 1.*Save/);
    assert.match(block, /元素 2.*a\.help/);
    assert.match(block, /可见文本 2.*Help/);
    assert.match(block, /两个入口都要更明显/);
    assert.doesNotMatch(block, /兄弟区间/);
    assert.doesNotMatch(block, /^- \*\*可见文本\*\*:/m);
    assert.doesNotMatch(block, /^- \*\*元素\*\*:/m);
    assert.doesNotMatch(block, /^- \*\*选择器\*\*:/m);
  });
});

describe('unionClientRects', () => {
  it('returns bounding union', () => {
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

describe('prefixCssPathWithFrames / applyFramePrefixesToSnapshot', () => {
  it('prefixCssPathWithFrames joins frame prefixes before cssPath', () => {
    assert.equal(
      prefixCssPathWithFrames('button.save', ['iframe#host', 'iframe.nested']),
      'iframe#host >>> iframe.nested >>> button.save',
    );
  });

  it('prefixCssPathWithFrames returns empty when cssPath is blank', () => {
    assert.equal(prefixCssPathWithFrames('', ['iframe#host']), '');
    assert.equal(prefixCssPathWithFrames('   ', ['iframe#host']), '');
  });

  it('applyFramePrefixesToSnapshot prefixes aggregate cssPath and per-element paths', () => {
    const next = applyFramePrefixesToSnapshot(
      {
        cssPath: 'div.root',
        elements: [
          { label: 'a', cssPath: 'button.save' },
          { label: 'b', cssPath: 'footer > a.help' },
          { label: 'c', cssPath: '' },
        ],
      },
      ['iframe#host'],
    );
    assert.equal(next.cssPath, 'iframe#host >>> div.root');
    assert.equal(next.elements[0].cssPath, 'iframe#host >>> button.save');
    assert.equal(next.elements[1].cssPath, 'iframe#host >>> footer > a.help');
    assert.equal(next.elements[2].cssPath, '');
  });

  it('applyFramePrefixesToSnapshot prefixes disjoint multi-select with empty aggregate cssPath', () => {
    const next = applyFramePrefixesToSnapshot(
      {
        selectionKind: 'disjoint',
        cssPath: '',
        elements: [
          { label: 'button.save', cssPath: 'button.save' },
          { label: 'a.help', cssPath: 'footer > a.help' },
        ],
      },
      ['iframe.outer', 'iframe.inner'],
    );
    assert.equal(next.cssPath, '');
    assert.equal(next.elements[0].cssPath, 'iframe.outer >>> iframe.inner >>> button.save');
    assert.equal(next.elements[1].cssPath, 'iframe.outer >>> iframe.inner >>> footer > a.help');
  });

  it('applyFramePrefixesToSnapshot is a no-op without prefixes', () => {
    const snap = { cssPath: 'button.save', elements: [{ cssPath: 'a' }] };
    assert.equal(applyFramePrefixesToSnapshot(snap, []), snap);
    assert.equal(applyFramePrefixesToSnapshot(snap, null), snap);
  });
});
