'use strict';

/**
 * 自动创新：快速创建任务浮窗仅在「全部/逐条填入任务描述」后打开。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeEl(tag, id) {
  const attrs = Object.create(null);
  return {
    tagName: String(tag || 'DIV').toUpperCase(),
    id: id || '',
    hidden: false,
    className: '',
    textContent: '',
    innerHTML: '',
    children: [],
    style: {},
    setAttribute(k, v) { attrs[String(k)] = String(v); },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
    },
    removeAttribute(k) { delete attrs[k]; },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
  };
}

/** @param {string} src @param {string} name @returns {string|null} */
function extractFunctionBody(src, name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  let start = -1;
  for (const marker of markers) {
    start = src.indexOf(marker);
    if (start >= 0) break;
  }
  if (start < 0) return null;
  const openParen = src.indexOf('(', start);
  if (openParen < 0) return null;
  let depthParen = 0;
  let closeParen = -1;
  for (let i = openParen; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '(') depthParen += 1;
    else if (ch === ')') {
      depthParen -= 1;
      if (depthParen === 0) {
        closeParen = i;
        break;
      }
    }
  }
  if (closeParen < 0) return null;
  const brace = src.indexOf('{', closeParen);
  if (brace < 0) return null;
  let depth = 0;
  for (let i = brace; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(brace, i + 1);
    }
  }
  return null;
}

describe('quick-create float opens only after fill into description', () => {
  it('source: openFloatPanelForAdvisor only from confirmPageAdvisorFill', () => {
    const ui = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor.js'),
      'utf8',
    );
    const layer = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-layer.js'),
      'utf8',
    );
    for (const name of [
      'showPageAdvisorLoading',
      'showPageAdvisorSuggestions',
      'showPageAdvisorResourceError',
    ]) {
      const body = extractFunctionBody(ui, name);
      assert.ok(body, `missing ${name}`);
      assert.doesNotMatch(
        body,
        /openFloatPanelForAdvisor\s*\(/,
        `${name} must not open 快速创建任务 panel`,
      );
      assert.match(
        body,
        /collapseFloatPanelDuringAdvisor\s*\(/,
        `${name} must collapse 快速创建任务 while advisor runs`,
      );
    }
    const fillBody = extractFunctionBody(ui, 'confirmPageAdvisorFill');
    assert.ok(fillBody);
    assert.match(
      fillBody,
      /openFloatPanelForAdvisor\s*\(/,
      'fill-all / fill-one must open 快速创建任务',
    );
    assert.doesNotMatch(
      extractFunctionBody(layer, 'handlePageAdvisorResultMessage') || '',
      /openFloatPanelForAdvisor\s*\(/,
      'advisor error path must not open 快速创建任务',
    );
    assert.match(layer, /function collapseFloatPanelDuringAdvisor/);
    assert.match(layer, /function openFloatPanelForAdvisor/);
  });

  it('vm: suggestions keep panel closed; fill-all opens it', () => {
    const panel = {
      classList: {
        _open: false,
        add(c) {
          if (c === 'taskplugin-open') this._open = true;
        },
        remove(c) {
          if (c === 'taskplugin-open') this._open = false;
        },
        contains(c) {
          return c === 'taskplugin-open' && this._open;
        },
      },
    };
    const btn = {
      classList: { add() {}, remove() {} },
      textContent: '+',
    };
    const cards = makeEl('div', 'taskplugin-page-advisor-cards');
    const layerEl = makeEl('div', 'taskplugin-page-advisor-layer');
    layerEl.hidden = true;
    const byId = {
      'taskplugin-page-advisor-layer': layerEl,
      'taskplugin-page-advisor-cards': cards,
      'taskplugin-page-advisor-links': makeEl('div', 'taskplugin-page-advisor-links'),
      'taskplugin-page-advisor-error': makeEl('div', 'taskplugin-page-advisor-error'),
      'taskplugin-page-advisor-live': makeEl('div', 'taskplugin-page-advisor-live'),
      'taskplugin-page-advisor-fill-all': makeEl('button', 'taskplugin-page-advisor-fill-all'),
      'taskplugin-page-advisor-fill-one': makeEl('button', 'taskplugin-page-advisor-fill-one'),
      'taskplugin-page-advisor-cancel': makeEl('button', 'taskplugin-page-advisor-cancel'),
      'taskplugin-page-advisor-retry': makeEl('button', 'taskplugin-page-advisor-retry'),
    };
    const descInput = { value: '', focus() {} };
    const sandbox = {
      console,
      Map,
      Math,
      Number,
      String,
      Array,
      panel,
      btn,
      isOpen: true,
      descInput,
      pageAdvisorState: { suggestions: [], pageUrl: '', jobId: '' },
      pageAdvisorConfirmGuard: null,
      pageAdvisorBusy: false,
      pageAdvisorPreviewSession: {
        undoAll() {},
        undoOne() {},
        applySuggestion() {},
      },
      PageAdvisorFill: {
        appendSuggestionsToDescription(cur, _suggestions, ids) {
          return `${cur}\n${ids.join(',')}`;
        },
      },
      PageAdvisorA11y: undefined,
      ClickGuard: undefined,
      document: {
        getElementById: (id) => byId[id] || null,
        querySelector: () => null,
        querySelectorAll: (sel) => {
          if (String(sel).includes('taskplugin-page-advisor-check:checked')) {
            return [{
              value: 's1',
              checked: true,
              getAttribute: () => '0',
            }];
          }
          return [];
        },
        createElement: (tag) => makeEl(tag),
        body: { appendChild() {} },
      },
      window: {
        addEventListener() {},
        requestAnimationFrame: (fn) => {
          fn();
          return 0;
        },
        innerWidth: 1280,
        innerHeight: 720,
      },
      esc: (s) => String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'),
      setDataTraceId() {},
      showResult() {},
      syncDescResetButton() {},
      clearAllPageAdvisorPins() {},
      bindPageAdvisorCardDrags() {},
      bindPageAdvisorCardRegionHover() {},
      layoutPageAdvisorCards() {},
      showPageAdvisorLayer() {},
      stopPageAdvisorDomWatcher() {},
      restorePageAdvisorDocumentTitle() {},
      clearPageAdvisorLastRegion() {},
      syncFloatPanelPrimaryHeading() {},
      syncFloatPanelFocusTrap() {},
      clearPageAdvisorRegionHighlight() {},
      DialogFocusTrap: undefined,
      PageContext: undefined,
    };
    panel.classList._open = true;

    const layerSrc = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-layer.js'),
      'utf8',
    );
    const advisorSrc = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor.js'),
      'utf8',
    );
    vm.runInNewContext(
      `${layerSrc}\n${advisorSrc}\n;`
        + 'this.showPageAdvisorSuggestions = showPageAdvisorSuggestions;'
        + 'this.confirmPageAdvisorFill = confirmPageAdvisorFill;'
        + 'this.getIsOpen = () => isOpen;'
        + 'this.getPanelOpen = () => panel.classList.contains("taskplugin-open");',
      sandbox,
    );

    sandbox.showPageAdvisorSuggestions({
      suggestions: [{ id: 's1', title: 'T', summary: 'S' }],
      pageUrl: 'https://example.test/',
      jobId: 'j1',
    });
    assert.equal(sandbox.getIsOpen(), false);
    assert.equal(sandbox.getPanelOpen(), false);
    assert.equal(layerEl.hidden, false);

    sandbox.pageAdvisorState = {
      suggestions: [{ id: 's1', title: 'T', summary: 'S' }],
      pageUrl: 'https://example.test/',
      jobId: 'j1',
    };
    sandbox.confirmPageAdvisorFill({ mode: 'all' });
    assert.equal(sandbox.getIsOpen(), true);
    assert.equal(sandbox.getPanelOpen(), true);
    assert.match(descInput.value, /s1/);
  });
});
