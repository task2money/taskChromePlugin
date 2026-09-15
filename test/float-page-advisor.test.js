'use strict';

/**
 * Content UI: page-advisor timeout / error must set data-traceId (constraint 24).
 * Loads float-page-advisor helpers against a minimal DOM mock (no jsdom).
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeEl(tag, id) {
  const attrs = Object.create(null);
  const el = {
    tagName: String(tag || 'DIV').toUpperCase(),
    id: id || '',
    hidden: false,
    className: '',
    textContent: '',
    innerHTML: '',
    children: [],
    style: {},
    setAttribute(k, v) { attrs[String(k)] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
  };
  return el;
}

describe('page-advisor error data-traceId', () => {
  let sandbox;
  let errorEl;

  beforeEach(() => {
    errorEl = makeEl('div', 'taskplugin-page-advisor-error');
    const cards = makeEl('div', 'taskplugin-page-advisor-cards');
    const links = makeEl('div', 'taskplugin-page-advisor-links');
    const retry = makeEl('button', 'taskplugin-page-advisor-retry');
    retry.hidden = true;
    const layer = makeEl('div', 'taskplugin-page-advisor-layer');
    layer.hidden = true;
    const byId = {
      'taskplugin-page-advisor-error': errorEl,
      'taskplugin-page-advisor-cards': cards,
      'taskplugin-page-advisor-links': links,
      'taskplugin-page-advisor-retry': retry,
      'taskplugin-page-advisor-layer': layer,
      'taskplugin-page-advisor-fill-all': makeEl('button', 'taskplugin-page-advisor-fill-all'),
      'taskplugin-page-advisor-fill-one': makeEl('button', 'taskplugin-page-advisor-fill-one'),
      'taskplugin-page-advisor-cancel': makeEl('button', 'taskplugin-page-advisor-cancel'),
    };

    sandbox = {
      console,
      pageAdvisorState: { suggestions: [], pageUrl: '', jobId: '' },
      pageAdvisorConfirmGuard: null,
      pageAdvisorBusy: false,
      btn: null,
      panel: null,
      isOpen: false,
      descInput: null,
      document: {
        getElementById: (id) => byId[id] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: (tag) => makeEl(tag),
        body: { appendChild() {} },
      },
      setDataTraceId(el, source) {
        const tid = String(source || '').trim();
        if (tid) el.setAttribute('data-traceId', tid);
        else el.removeAttribute('data-traceId');
      },
      esc: (s) => String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'),
      ensurePageAdvisorLayer: () => byId['taskplugin-page-advisor-layer'],
      openFloatPanelForAdvisor() {},
      syncPageAdvisorFillButtons() {},
      showPageAdvisorLayer() {},
      showPageAdvisorLoading(message) {
        const c = byId['taskplugin-page-advisor-cards'];
        if (c) c.innerHTML = message || '';
        sandbox.setPageAdvisorError('');
      },
      showPageAdvisorResourceError() {},
      getPageAdvisorPreviewSession: () => null,
    };

    const advisorSrc = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor.js'),
      'utf8',
    );
    const layerSrc = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-layer.js'),
      'utf8',
    );
    // Only need setPageAdvisorError + handlePageAdvisorResultMessage — eval both.
    vm.runInNewContext(
      `${advisorSrc}\n${layerSrc}\n;`
      + 'this.setPageAdvisorError = setPageAdvisorError;'
      + 'this.handlePageAdvisorResultMessage = handlePageAdvisorResultMessage;',
      sandbox,
    );
  });

  it('timeout error mounts data-traceId on #taskplugin-page-advisor-error', () => {
    sandbox.handlePageAdvisorResultMessage({
      ok: false,
      error: '生成优化建议超时（75 秒），请重试',
      errorCode: 'PAGE_ADVISOR_TIMEOUT',
      traceId: 'timeout-trace-xyz',
    });
    assert.equal(errorEl.textContent, '生成优化建议超时（75 秒），请重试');
    assert.equal(errorEl.getAttribute('data-traceId'), 'timeout-trace-xyz');
  });

  it('error without traceId omits data-traceId attribute', () => {
    sandbox.handlePageAdvisorResultMessage({
      ok: false,
      error: '生成优化建议超时（75 秒），请重试',
      errorCode: 'PAGE_ADVISOR_TIMEOUT',
      traceId: '',
    });
    assert.equal(errorEl.getAttribute('data-traceId'), null);
  });
});

describe('dismissPageAdvisorSuggestion focus restore', () => {
  it('focuses fill-one or next card when layer stays open', () => {
    const ui = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor.js'),
      'utf8',
    );
    const layer = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-layer.js'),
      'utf8',
    );
    assert.match(layer, /function focusAfterPageAdvisorDismiss/);
    assert.match(ui, /taskplugin-page-advisor-fill-one/);
    assert.match(
      ui,
      /dismissPageAdvisorSuggestion[\s\S]*focusAfterPageAdvisorDismiss/,
    );
  });

  it('vm: dismiss moves focus to fill-one when enabled', () => {
    let focused = null;
    const fillOne = {
      disabled: false,
      setAttribute() {},
      textContent: '',
      focus() {
        focused = 'fill-one';
      },
    };
    const byId = {
      'taskplugin-page-advisor-layer': { hidden: false },
      'taskplugin-page-advisor-cards': {
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
      },
      'taskplugin-page-advisor-fill-all': {
        disabled: false,
        setAttribute() {},
        textContent: '',
      },
      'taskplugin-page-advisor-fill-one': fillOne,
      'taskplugin-page-advisor-fill-all': {
        disabled: false,
        setAttribute() {},
        textContent: '',
      },
    };
    const sandbox = {
      document: {
        getElementById: (id) => byId[id] || null,
        querySelector: (sel) => {
          if (String(sel).includes('data-sid="s1"')) {
            return { remove() {} };
          }
          return null;
        },
        querySelectorAll: (sel) => {
          if (String(sel).includes('taskplugin-page-advisor-check:checked')) {
            return [{
              value: 's2',
              checked: true,
              getAttribute: () => '1',
            }];
          }
          return [];
        },
        createElement: () => ({
          setAttribute() {},
          addEventListener() {},
          appendChild() {},
        }),
        body: { appendChild() {} },
      },
      isPageAdvisorLayerVisible: () => true,
      showPageAdvisorLoading() {},
      setPageAdvisorError() {},
      clearPageAdvisorPin() {},
      syncPageAdvisorFillButtons() {},
      layoutPageAdvisorCards() {},
      closePageAdvisorModal() {},
      stopPageAdvisorDomWatcher() {},
      restorePageAdvisorDocumentTitle() {},
      setPageAdvisorLiveStatus() {},
      syncFloatPanelFocusTrap() {},
      ClickGuard: undefined,
      pageAdvisorState: { suggestions: [{ id: 's1' }, { id: 's2' }], pageUrl: '', jobId: '' },
      pageAdvisorPreviewSession: { undoOne() {}, undoAll() {} },
      esc: (s) => String(s || ''),
      chrome: { runtime: { sendMessage() {}, lastError: null } },
      window: { addEventListener() {}, requestAnimationFrame: () => 0 },
      console,
    };
    const src = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor.js'),
      'utf8',
    );
    const layerSrc = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-layer.js'),
      'utf8',
    );
    vm.runInNewContext(
      `${layerSrc}\n${src}\n`
      + 'this.dismissPageAdvisorSuggestion = dismissPageAdvisorSuggestion;\n',
      sandbox,
    );
    sandbox.pageAdvisorState = {
      suggestions: [{ id: 's1' }, { id: 's2' }],
      pageUrl: '',
      jobId: '',
    };
    sandbox.dismissPageAdvisorSuggestion('s1');
    assert.equal(focused, 'fill-one');
  });
});

describe('float-page-advisor dismiss wiring', () => {
  it('binds dismiss with ClickGuard and mousedown stopPropagation', () => {
    const ui = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor.js'),
      'utf8',
    );
    assert.match(ui, /function dismissPageAdvisorSuggestion/);
    assert.match(ui, /pageAdvisorDismissGuard/);
    assert.match(ui, /aria-label="关闭此建议"/);
    assert.match(
      ui,
      /taskplugin-page-advisor-dismiss[\s\S]*?addEventListener\("mousedown"[\s\S]*?stopPropagation/,
    );
  });
});
