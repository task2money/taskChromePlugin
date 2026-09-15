'use strict';

/**
 * Pin-state helpers for Alt+E advisor card drag (content script globals via vm).
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

describe('page-advisor-card-drag pin state', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = {
      Map,
      Math,
      Number,
      String,
      document: {
        removeEventListener() {},
        addEventListener() {},
      },
      DRAG_THRESHOLD: 4,
      console,
    };
    const src = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-drag.js'),
      'utf8',
    );
    vm.runInNewContext(
      `${src}\n;`
      + 'this.getPageAdvisorPin = getPageAdvisorPin;'
      + 'this.setPageAdvisorPin = setPageAdvisorPin;'
      + 'this.clearPageAdvisorPin = clearPageAdvisorPin;'
      + 'this.clearAllPageAdvisorPins = clearAllPageAdvisorPins;'
      + 'this.isPageAdvisorPinned = isPageAdvisorPinned;',
      sandbox,
    );
  });

  it('set/get/clear pin by sid', () => {
    sandbox.setPageAdvisorPin('s1', 12.6, 40.2);
    const pin = sandbox.getPageAdvisorPin('s1');
    assert.equal(pin.top, 13);
    assert.equal(pin.left, 40);
    assert.equal(sandbox.isPageAdvisorPinned('s1'), true);
    sandbox.clearPageAdvisorPin('s1');
    assert.equal(sandbox.getPageAdvisorPin('s1'), null);
    assert.equal(sandbox.isPageAdvisorPinned('s1'), false);
  });

  it('drag handle binds Arrow key nudge and persists pin', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-drag.js'),
      'utf8',
    );
    assert.match(src, /PAGE_ADVISOR_KEYBOARD_NUDGE_PX/);
    assert.match(src, /addEventListener\('keydown'/);
    assert.match(src, /ArrowUp[\s\S]*setPageAdvisorPin/);
  });

  it('clearAll removes every pin', () => {
    sandbox.setPageAdvisorPin('a', 1, 2);
    sandbox.setPageAdvisorPin('b', 3, 4);
    sandbox.clearAllPageAdvisorPins();
    assert.equal(sandbox.isPageAdvisorPinned('a'), false);
    assert.equal(sandbox.isPageAdvisorPinned('b'), false);
  });
});

describe('page-advisor card layout wiring', () => {
  it('manifest injects layout + drag before float-page-advisor', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'),
    );
    const js = manifest.content_scripts[0].js;
    const css = manifest.content_scripts[0].css;
    const layout = js.indexOf('lib/page-advisor-card-layout.js');
    const drag = js.indexOf('content/float-page-advisor-drag.js');
    const ui = js.indexOf('content/float-page-advisor.js');
    assert.ok(layout >= 0);
    assert.ok(drag >= 0);
    assert.ok(ui >= 0);
    assert.ok(layout < ui);
    assert.ok(drag < ui);
    assert.ok(css.includes('content/page-advisor.css'));
  });

  it('float-page-advisor uses PageAdvisorCardLayout and drag handle markup', () => {
    const ui = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor.js'),
      'utf8',
    );
    const layer = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-layer.js'),
      'utf8',
    );
    const src = ui + layer;
    assert.match(src, /PageAdvisorCardLayout/);
    assert.match(src, /taskplugin-page-advisor-drag-handle/);
    assert.match(src, /bindPageAdvisorCardDrags/);
    assert.match(src, /clearAllPageAdvisorPins/);
    assert.match(ui, /dismissPageAdvisorSuggestion/);
    assert.match(ui, /taskplugin-page-advisor-dismiss/);
    assert.match(ui, /aria-label="关闭此建议"/);
    assert.match(ui, /pageAdvisorDismissGuard/);
    assert.match(ui, /mousedown[\s\S]*stopPropagation/);
  });

  it('page-advisor.css raises z-index on hover/focus-within above base', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '../content/page-advisor.css'),
      'utf8',
    );
    const base = css.match(
      /\.taskplugin-page-advisor-float-card\s*\{[^}]*z-index:\s*(\d+)/s,
    );
    const raised = css.match(
      /\.taskplugin-page-advisor-float-card:hover[\s\S]*?z-index:\s*(\d+)/,
    );
    assert.ok(base, 'base float-card z-index');
    assert.ok(raised, 'hover/focus z-index');
    assert.ok(
      Number(raised[1]) > Number(base[1]),
      `hover z-index ${raised[1]} must exceed base ${base[1]}`,
    );
  });
});

describe('page-advisor dismissPageAdvisorSuggestion', () => {
  it('removes card, clears pin, and undoes preview for sid', () => {
    const removed = [];
    const undone = [];
    const cleared = [];
    const cards = {
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };
    const byId = {
      'taskplugin-page-advisor-cards': cards,
      'taskplugin-page-advisor-fill-all': {
        disabled: false,
        setAttribute() {},
        textContent: '',
      },
      'taskplugin-page-advisor-fill-one': {
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
            return {
              remove() {
                removed.push('s1');
              },
            };
          }
          return null;
        },
        querySelectorAll: () => [],
        createElement: () => ({
          setAttribute() {},
          addEventListener() {},
          appendChild() {},
        }),
        body: { appendChild() {} },
      },
      clearPageAdvisorPin(id) {
        cleared.push(String(id));
      },
      syncPageAdvisorFillButtons() {},
      layoutPageAdvisorCards() {},
      closePageAdvisorModal() {},
      stopPageAdvisorDomWatcher() {},
      restorePageAdvisorDocumentTitle() {},
      setPageAdvisorLiveStatus() {},
      syncFloatPanelFocusTrap() {},
      ClickGuard: undefined,
      PageAdvisorPreview: undefined,
      PageAdvisorA11y: undefined,
      PageContext: undefined,
      DialogFocusTrap: undefined,
      root: null,
      btn: null,
      panel: null,
      isOpen: false,
      esc: (s) => String(s || ''),
      chrome: { runtime: { sendMessage() {}, lastError: null } },
      window: {
        addEventListener() {},
        requestAnimationFrame() {
          return 0;
        },
      },
      console,
      undone,
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
      + 'pageAdvisorPreviewSession = {\n'
      + '  undoOne(id) { undone.push(String(id)); },\n'
      + '  undoAll() {},\n'
      + '};\n'
      + 'this.dismissPageAdvisorSuggestion = dismissPageAdvisorSuggestion;\n'
      + 'this.getAdvisorState = () => pageAdvisorState;\n',
      sandbox,
    );
    sandbox.pageAdvisorState = {
      suggestions: [{ id: 's1', title: 'a' }, { id: 's2', title: 'b' }],
      pageUrl: '',
      jobId: '',
    };
    const r = sandbox.dismissPageAdvisorSuggestion('s1');
    assert.equal(r.dismissed, true);
    assert.deepEqual(undone, ['s1']);
    assert.deepEqual(cleared, ['s1']);
    assert.deepEqual(removed, ['s1']);
    assert.equal(sandbox.getAdvisorState().suggestions.length, 1);
    assert.equal(sandbox.getAdvisorState().suggestions[0].id, 's2');
  });
});
