'use strict';

/**
 * Alt+E / Alt+Shift+E：悬浮优化卡悬停时高亮对应页面锚点区域。
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadLayer(sandboxExtras) {
  const sandbox = {
    Map,
    Math,
    Number,
    String,
    Array,
    document: {
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      createElement(tag) {
        return {
          tagName: String(tag || '').toUpperCase(),
          id: '',
          textContent: '',
          setAttribute() {},
          appendChild() {},
        };
      },
      head: { appendChild() {} },
      documentElement: { appendChild() {} },
    },
    window: { innerWidth: 1280, innerHeight: 720 },
    console,
    pageAdvisorState: { suggestions: [], pageUrl: '', jobId: '' },
    ...sandboxExtras,
  };
  const src = fs.readFileSync(
    path.join(__dirname, '../content/float-page-advisor-layer.js'),
    'utf8',
  );
  vm.runInNewContext(
    `${src}\n;`
      + 'this.resolveSuggestionAnchor = resolveSuggestionAnchor;'
      + 'this.clearPageAdvisorRegionHighlight = clearPageAdvisorRegionHighlight;'
      + 'this.applyPageAdvisorRegionHighlight = applyPageAdvisorRegionHighlight;'
      + 'this.highlightPageAdvisorCardRegion = highlightPageAdvisorCardRegion;'
      + 'this.bindPageAdvisorCardRegionHover = bindPageAdvisorCardRegionHover;'
      + 'this.getPageAdvisorRegionHighlightEls = function () { return pageAdvisorRegionHighlightEls.slice(); };',
    sandbox,
  );
  return sandbox;
}

describe('page-advisor card region hover highlight', () => {
  it('css styles advisor region highlight without requiring picking mode', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '../content/page-advisor.css'),
      'utf8',
    );
    assert.match(css, /\.taskplugin-advisor-region-highlight\s*\{/);
    assert.doesNotMatch(
      css,
      /html\.taskplugin-picking\s+\.taskplugin-advisor-region-highlight/,
    );
  });

  it('float-page-advisor binds region hover after cards render and clears on close', () => {
    const ui = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor.js'),
      'utf8',
    );
    assert.match(ui, /bindPageAdvisorCardRegionHover/);
    assert.match(ui, /clearPageAdvisorRegionHighlight/);
    const closeIdx = ui.indexOf('function closePageAdvisorModal');
    const clearIdx = ui.indexOf('clearPageAdvisorRegionHighlight', closeIdx);
    assert.ok(closeIdx >= 0);
    assert.ok(clearIdx > closeIdx, 'close must clear region highlight');
  });

  it('user guide mentions hover card highlights page region', () => {
    const guide = fs.readFileSync(
      path.join(__dirname, '../docs/USER_GUIDE.md'),
      'utf8',
    );
    const ug = fs.readFileSync(
      path.join(__dirname, '../lib/user-guide.js'),
      'utf8',
    );
    assert.match(guide, /悬停.*优化卡|优化卡.*悬停|悬停.*高亮/);
    assert.match(ug, /悬停.*高亮|高亮.*对应/);
  });

  describe('highlight helpers (vm)', () => {
    let sandbox;
    let anchorEl;

    beforeEach(() => {
      anchorEl = {
        nodeType: 1,
        classList: {
          _set: new Set(),
          add(c) {
            this._set.add(c);
          },
          remove(c) {
            this._set.delete(c);
          },
          contains(c) {
            return this._set.has(c);
          },
        },
        ownerDocument: null,
        getAttribute(name) {
          if (name === 'data-taskplugin-nid') return 'n1';
          return null;
        },
        textContent: '登录按钮',
      };
      const doc = {
        _styleAppended: false,
        getElementById(id) {
          if (id === 'taskplugin-advisor-region-hl-style' && this._styleAppended) {
            return { id };
          }
          return null;
        },
        querySelector(sel) {
          if (String(sel).includes('data-taskplugin-nid="n1"')) return anchorEl;
          return null;
        },
        querySelectorAll(sel) {
          if (String(sel).includes('data-taskplugin-nid')) return [anchorEl];
          return [];
        },
        createElement(tag) {
          return {
            tagName: String(tag || '').toUpperCase(),
            id: '',
            textContent: '',
            setAttribute() {},
          };
        },
        head: {
          appendChild(node) {
            if (node && node.id === 'taskplugin-advisor-region-hl-style') {
              doc._styleAppended = true;
            }
          },
        },
        documentElement: { appendChild() {} },
      };
      anchorEl.ownerDocument = doc;
      sandbox = loadLayer({ document: doc });
      sandbox.pageAdvisorState = {
        suggestions: [
          {
            id: 's1',
            target_nid: 'n1',
            anchor_text: '登录',
            title: '强化登录 CTA',
          },
        ],
        pageUrl: '',
        jobId: '',
      };
    });

    it('apply/clear toggles taskplugin-advisor-region-highlight on anchor', () => {
      sandbox.applyPageAdvisorRegionHighlight(anchorEl);
      assert.equal(
        anchorEl.classList.contains('taskplugin-advisor-region-highlight'),
        true,
      );
      assert.equal(sandbox.getPageAdvisorRegionHighlightEls().length, 1);
      sandbox.clearPageAdvisorRegionHighlight();
      assert.equal(
        anchorEl.classList.contains('taskplugin-advisor-region-highlight'),
        false,
      );
      assert.equal(sandbox.getPageAdvisorRegionHighlightEls().length, 0);
    });

    it('highlightPageAdvisorCardRegion resolves target_nid and highlights', () => {
      const card = {
        getAttribute(name) {
          return name === 'data-sid' ? 's1' : null;
        },
      };
      sandbox.highlightPageAdvisorCardRegion(card);
      assert.equal(
        anchorEl.classList.contains('taskplugin-advisor-region-highlight'),
        true,
      );
    });

    it('bindPageAdvisorCardRegionHover wires mouseenter/mouseleave', () => {
      const listeners = {};
      const card = {
        getAttribute(name) {
          if (name === 'data-sid') return 's1';
          if (name === 'data-region-hover-bound') return null;
          return null;
        },
        setAttribute(name, val) {
          if (name === 'data-region-hover-bound') {
            this._bound = val;
          }
        },
        addEventListener(type, fn) {
          listeners[type] = fn;
        },
        contains() {
          return false;
        },
      };
      const root = {
        querySelectorAll() {
          return [card];
        },
      };
      sandbox.bindPageAdvisorCardRegionHover(root);
      assert.equal(typeof listeners.mouseenter, 'function');
      assert.equal(typeof listeners.mouseleave, 'function');
      listeners.mouseenter();
      assert.equal(
        anchorEl.classList.contains('taskplugin-advisor-region-highlight'),
        true,
      );
      listeners.mouseleave();
      assert.equal(
        anchorEl.classList.contains('taskplugin-advisor-region-highlight'),
        false,
      );
    });
  });
});
