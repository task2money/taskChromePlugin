'use strict';

/**
 * float-page-advisor-layer: failed pageAdvisorResult must pass traceId/trace_id
 * into setPageAdvisorError (constraint 24 + copyable visible line).
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
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
    style: {},
    setAttribute(k, v) { attrs[String(k)] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
  };
}

describe('float-page-advisor-layer result message', () => {
  let sandbox;
  let errorEl;

  beforeEach(() => {
    errorEl = makeEl('div', 'taskplugin-page-advisor-error');
    const cards = makeEl('div', 'taskplugin-page-advisor-cards');
    const retry = makeEl('button', 'taskplugin-page-advisor-retry');
    retry.hidden = true;
    const layer = makeEl('div', 'taskplugin-page-advisor-layer');
    layer.hidden = true;
    const byId = {
      'taskplugin-page-advisor-error': errorEl,
      'taskplugin-page-advisor-cards': cards,
      'taskplugin-page-advisor-links': makeEl('div', 'taskplugin-page-advisor-links'),
      'taskplugin-page-advisor-retry': retry,
      'taskplugin-page-advisor-layer': layer,
      'taskplugin-page-advisor-fill-all': makeEl('button'),
      'taskplugin-page-advisor-fill-one': makeEl('button'),
      'taskplugin-page-advisor-cancel': makeEl('button'),
    };
    sandbox = {
      console,
      pageAdvisorState: { suggestions: [], pageUrl: '', jobId: '' },
      pageAdvisorBusy: false,
      document: {
        getElementById: (id) => byId[id] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: (tag) => makeEl(tag),
        body: { appendChild() {} },
      },
      extractTraceId(source) {
        if (source == null || source === '') return '';
        if (typeof source === 'string') return source.trim();
        return String(source.traceId ?? source.trace_id ?? '').trim();
      },
      setDataTraceId(el, source) {
        const tid = sandbox.extractTraceId(source);
        if (tid) el.setAttribute('data-traceId', tid);
        else el.removeAttribute('data-traceId');
      },
      esc: (s) => String(s || ''),
      ensurePageAdvisorLayer: () => layer,
      syncPageAdvisorFillButtons() {},
      showPageAdvisorLayer() {},
      collapseFloatPanelDuringAdvisor() {},
      showPageAdvisorLoading() {
        sandbox.setPageAdvisorError('');
      },
      showPageAdvisorResourceError() {},
    };
    const advisorSrc = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor.js'),
      'utf8',
    );
    const layerSrc = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-layer.js'),
      'utf8',
    );
    vm.runInNewContext(
      `${advisorSrc}\n${layerSrc}\n;`
      + 'this.setPageAdvisorError = setPageAdvisorError;'
      + 'this.handlePageAdvisorResultMessage = handlePageAdvisorResultMessage;',
      sandbox,
    );
  });

  it('accepts snake_case trace_id from SW payload', () => {
    sandbox.handlePageAdvisorResultMessage({
      ok: false,
      error: "parse suggestions json: invalid character 'f' after object key:value pair",
      errorCode: 'LLM_FAILED',
      trace_id: 'create-time-trace-from-job',
    });
    assert.equal(errorEl.getAttribute('data-traceId'), 'create-time-trace-from-job');
    assert.match(errorEl.textContent, /traceId:\s*create-time-trace-from-job/);
  });
});
