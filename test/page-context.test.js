'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_PAGE_TEXT_RUNES,
  MAX_DOM_OUTLINE_NODES,
  MAX_OUTLINE_LABEL_CHARS,
  MAX_OUTLINE_ARIA_CHARS,
  MAX_OUTLINE_HTML_SNIPPET_CHARS,
  truncatePageText,
  isElementSkipped,
  extractVisibleReadableText,
  capturePageContext,
  capturePageContextInRect,
  capturePageContextForElements,
  captureDomOutline,
} = require('../lib/page-context.js');
const { buildPageAdvisorPrompt } = require('../lib/page-advisor-llm-client.js');

const NID_ATTR = 'data-taskplugin-nid';

function textNode(value, parent) {
  return { nodeType: 3, nodeValue: value, parentElement: parent, childNodes: [] };
}

function el(tag, { attrs = {}, style = {}, children = [], hidden = false, id = '' } = {}) {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    id: id || (attrs.id != null ? String(attrs.id) : ''),
    hidden,
    style,
    childNodes: [],
    parentElement: null,
    getAttribute(name) {
      return attrs[name] != null ? String(attrs[name]) : null;
    },
    closest(selector) {
      const want = String(selector || '').startsWith('#')
        ? String(selector).slice(1)
        : null;
      let cur = node;
      while (cur) {
        if (want && cur.id === want) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
  };
  for (const c of children) {
    if (c.nodeType === 3) c.parentElement = node;
    else c.parentElement = node;
    node.childNodes.push(c);
  }
  return node;
}

describe('page-context truncatePageText', () => {
  it('returns unchanged when under limit', () => {
    const { text, truncated } = truncatePageText('hello');
    assert.equal(text, 'hello');
    assert.equal(truncated, false);
  });

  it('truncates by rune count at 32KiB default', () => {
    const long = 'あ'.repeat(MAX_PAGE_TEXT_RUNES + 10);
    const { text, truncated } = truncatePageText(long);
    assert.equal(truncated, true);
    assert.equal(Array.from(text).length, MAX_PAGE_TEXT_RUNES);
  });

  it('respects custom maxRunes', () => {
    const { text, truncated } = truncatePageText('abcdef', 3);
    assert.equal(text, 'abc');
    assert.equal(truncated, true);
  });
});

describe('page-context extractVisibleReadableText', () => {
  it('skips script/style and hidden nodes', () => {
    const root = el('div', {
      children: [
        el('p', { children: [textNode('visible')] }),
        el('script', { children: [textNode('evil()')] }),
        el('style', { children: [textNode('.x{}')] }),
        el('div', { style: { display: 'none' }, children: [textNode('hidden')] }),
        el('span', { attrs: { 'aria-hidden': 'true' }, children: [textNode('aria')] }),
        el('div', { hidden: true, children: [textNode('attr-hidden')] }),
        el('p', { children: [textNode('  more  text ')] }),
      ],
    });
    const out = extractVisibleReadableText(root);
    assert.equal(out, 'visible more text');
    assert.ok(!out.includes('evil'));
    assert.ok(!out.includes('hidden'));
  });

  it('isElementSkipped recognizes SKIP tags', () => {
    assert.equal(isElementSkipped(el('script')), true);
    assert.equal(isElementSkipped(el('p')), false);
  });
});

describe('page-context capturePageContext', () => {
  it('returns url title pageText with truncation flag', () => {
    const root = el('body', {
      children: [el('p', { children: [textNode('hello world')] })],
    });
    const ctx = capturePageContext({
      url: 'https://example.com/x',
      title: 'Example',
      root,
    });
    assert.equal(ctx.url, 'https://example.com/x');
    assert.equal(ctx.title, 'Example');
    assert.equal(ctx.pageText, 'hello world');
    assert.equal(ctx.pageTextTruncated, false);
  });
});

describe('page-context capturePageContextInRect', () => {
  it('only includes text from elements intersecting the region', () => {
    const left = el('p', { children: [textNode('LEFT')] });
    const right = el('p', { children: [textNode('RIGHT')] });
    const root = el('body', { children: [left, right] });
    const rects = new Map([
      [left, { left: 0, top: 0, width: 40, height: 20 }],
      [right, { left: 100, top: 0, width: 40, height: 20 }],
      [root, { left: 0, top: 0, width: 200, height: 40 }],
    ]);
    const ctx = capturePageContextInRect({
      url: 'https://example.com/r',
      title: 'Region',
      root,
      region: { left: 0, top: 0, width: 50, height: 30 },
      stampNids: false,
      getBoundingClientRect: (node) => rects.get(node) || { left: 0, top: 0, width: 0, height: 0 },
    });
    assert.equal(ctx.regionScoped, true);
    assert.match(ctx.pageText, /LEFT/);
    assert.doesNotMatch(ctx.pageText, /RIGHT/);
  });

  it('excludes #taskplugin-float-root so region suggest never optimizes the float panel', () => {
    const page = el('p', { children: [textNode('HOST_PAGE')] });
    const floatLabel = el('label', { children: [textNode('工作空间')] });
    const floatRoot = el('div', {
      id: 'taskplugin-float-root',
      children: [floatLabel],
    });
    const root = el('body', { children: [page, floatRoot] });
    const rects = new Map([
      [page, { left: 0, top: 0, width: 100, height: 40 }],
      [floatLabel, { left: 10, top: 10, width: 80, height: 20 }],
      [floatRoot, { left: 0, top: 0, width: 200, height: 200 }],
      [root, { left: 0, top: 0, width: 400, height: 400 }],
    ]);
    const ctx = capturePageContextInRect({
      url: 'https://example.com/host',
      title: 'Host',
      root,
      region: { left: 0, top: 0, width: 200, height: 200 },
      stampNids: false,
      getBoundingClientRect: (node) => rects.get(node) || { left: 0, top: 0, width: 0, height: 0 },
    });
    assert.match(ctx.pageText, /HOST_PAGE/);
    assert.doesNotMatch(ctx.pageText, /工作空间/);
  });

  it('pierces same-origin iframe and captures intersecting child text', () => {
    const inner = el('p', { children: [textNode('IFRAME_INNER')] });
    const iframeBody = el('body', { children: [inner] });
    const iframe = el('iframe', {});
    iframe.contentDocument = { body: iframeBody, documentElement: iframeBody };
    const outside = el('p', { children: [textNode('TOP_ONLY')] });
    const root = el('body', { children: [outside, iframe] });
    const rects = new Map([
      [outside, { left: 0, top: 0, width: 40, height: 20 }],
      [iframe, { left: 100, top: 0, width: 200, height: 100 }],
      [inner, { left: 10, top: 10, width: 50, height: 20 }],
      [iframeBody, { left: 0, top: 0, width: 200, height: 100 }],
      [root, { left: 0, top: 0, width: 400, height: 200 }],
    ]);
    const ctx = capturePageContextInRect({
      url: 'https://example.com/iframe',
      title: 'Iframe',
      root,
      region: { left: 100, top: 0, width: 80, height: 40 },
      stampNids: false,
      getBoundingClientRect: (node) => rects.get(node) || { left: 0, top: 0, width: 0, height: 0 },
    });
    assert.match(ctx.pageText, /IFRAME_INNER/);
    assert.doesNotMatch(ctx.pageText, /TOP_ONLY/);
  });

  it('skips cross-origin iframe without throwing', () => {
    const iframe = el('iframe', {});
    Object.defineProperty(iframe, 'contentDocument', {
      get() {
        throw new Error('Blocked a frame with origin');
      },
    });
    const root = el('body', { children: [iframe] });
    const rects = new Map([
      [iframe, { left: 0, top: 0, width: 100, height: 100 }],
      [root, { left: 0, top: 0, width: 200, height: 200 }],
    ]);
    const ctx = capturePageContextInRect({
      url: 'https://example.com/xframe',
      title: 'X',
      root,
      region: { left: 0, top: 0, width: 50, height: 50 },
      stampNids: false,
      getBoundingClientRect: (node) => rects.get(node) || { left: 0, top: 0, width: 0, height: 0 },
    });
    assert.equal(ctx.pageText, '');
  });
});

describe('page-context extractVisibleReadableText skips plugin chrome', () => {
  it('skips float-root subtree for full-page Alt+Z capture', () => {
    const page = el('p', { children: [textNode('PAGE_OK')] });
    const floatInner = el('span', { children: [textNode('FLOAT_NO')] });
    const floatRoot = el('div', { id: 'taskplugin-float-root', children: [floatInner] });
    const root = el('body', { children: [page, floatRoot] });
    const text = extractVisibleReadableText(root);
    assert.match(text, /PAGE_OK/);
    assert.doesNotMatch(text, /FLOAT_NO/);
  });
});

describe('page-context capturePageContextForElements', () => {
  it('only includes text from selected element subtrees', () => {
    const keep = el('div', { children: [el('p', { children: [textNode('KEEP')] })] });
    const drop = el('div', { children: [el('p', { children: [textNode('DROP')] })] });
    const ctx = capturePageContextForElements({
      url: 'https://example.com/el',
      title: 'Els',
      roots: [keep],
      stampNids: false,
    });
    assert.equal(ctx.regionScoped, true);
    assert.match(ctx.pageText, /KEEP/);
    assert.doesNotMatch(ctx.pageText, /DROP/);
    void drop;
  });
});

/**
 * OPT-20261007-006：DOM 大纲整段进 LLM 提示（buildPageAdvisorPrompt 直接
 * JSON.stringify(page.domOutline)）。html_snippet / label 这类富信息有助于模型把建议
 * 锚到正确节点，但逐节点长度必须封顶 —— class 密集页面能把 200 节点大纲撑到上百万
 * 字符，token 成本随页面结构无界膨胀。
 */
describe('DOM 大纲进 LLM 提示的长度控制', () => {
  const savedAnchor = globalThis.pageAdvisorDomAnchor;
  afterEach(() => {
    if (savedAnchor === undefined) delete globalThis.pageAdvisorDomAnchor;
    else globalThis.pageAdvisorDomAnchor = savedAnchor;
  });

  function fakeNidEl(nid, text = '') {
    return {
      nodeType: 1,
      tagName: 'BUTTON',
      hidden: false,
      parentElement: null,
      textContent: text,
      getAttribute(name) {
        return name === NID_ATTR ? nid : null;
      },
    };
  }

  function fakeNidRoot(nodes) {
    return { querySelectorAll: () => nodes };
  }

  it('逐节点字段按上限截断（label / aria-label / html_snippet / css_path）', () => {
    globalThis.pageAdvisorDomAnchor = () => ({
      label: 'b'.repeat(MAX_OUTLINE_LABEL_CHARS + 50),
      aria_label: 'a'.repeat(MAX_OUTLINE_ARIA_CHARS + 50),
      html_snippet: 'h'.repeat(MAX_OUTLINE_HTML_SNIPPET_CHARS + 50),
      css_path: 'c'.repeat(MAX_OUTLINE_LABEL_CHARS + 50),
      visible_text: 'v'.repeat(MAX_OUTLINE_LABEL_CHARS + 50),
      landmark: 'l'.repeat(MAX_OUTLINE_ARIA_CHARS + 50),
    });
    const [node] = captureDomOutline(fakeNidRoot([fakeNidEl('n1')]), 1);
    assert.equal(node.label.length, MAX_OUTLINE_LABEL_CHARS);
    assert.equal(node.aria_label.length, MAX_OUTLINE_ARIA_CHARS);
    assert.equal(node.html_snippet.length, MAX_OUTLINE_HTML_SNIPPET_CHARS);
    assert.equal(node.css_path.length, MAX_OUTLINE_LABEL_CHARS);
    assert.equal(node.visible_text.length, MAX_OUTLINE_LABEL_CHARS);
    assert.equal(node.landmark.length, MAX_OUTLINE_ARIA_CHARS);
  });

  it('按 rune 截断，不切碎代理对', () => {
    globalThis.pageAdvisorDomAnchor = () => ({ label: '🙂'.repeat(MAX_OUTLINE_LABEL_CHARS + 5) });
    const [node] = captureDomOutline(fakeNidRoot([fakeNidEl('n1')]), 1);
    assert.equal(node.label, '🙂'.repeat(MAX_OUTLINE_LABEL_CHARS));
  });

  it('满额 200 节点的提示长度有上界', () => {
    globalThis.pageAdvisorDomAnchor = () => ({
      label: 'b'.repeat(500),
      aria_label: 'a'.repeat(500),
      html_snippet: 'h'.repeat(5000),
      css_path: 'c'.repeat(500),
      visible_text: 'v'.repeat(500),
      landmark: 'l'.repeat(500),
    });
    const nodes = [];
    for (let i = 0; i < MAX_DOM_OUTLINE_NODES; i += 1) nodes.push(fakeNidEl('n' + i, 'x'.repeat(500)));
    const outline = captureDomOutline(fakeNidRoot(nodes), MAX_DOM_OUTLINE_NODES);
    assert.equal(outline.length, MAX_DOM_OUTLINE_NODES);

    const prompt = buildPageAdvisorPrompt({
      url: 'https://x',
      title: 't',
      pageText: 'p',
      domOutline: outline,
    });
    // 每节点：5 个 label 级字段 + 2 个 aria 级字段 + html_snippet + text，另留 JSON 键名余量。
    const perNodeBudget = 240
      + MAX_OUTLINE_HTML_SNIPPET_CHARS
      + MAX_OUTLINE_LABEL_CHARS * 5
      + MAX_OUTLINE_ARIA_CHARS * 2
      + 80;
    const budget = MAX_DOM_OUTLINE_NODES * perNodeBudget;
    assert.ok(prompt.length <= budget, `prompt=${prompt.length} budget=${budget}`);
  });
});
