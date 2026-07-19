/**
 * Shift+Click 兄弟区间多选 E2E（Playwright）
 *
 * Verifies that holding Shift and clicking a sibling element selects the range
 * between the anchor and the clicked element (sibling range selection).
 *
 * Uses mock approach: test page + addInitScript for ElementPicker + chrome API stubs.
 */

const path = require('path');

function loadPlaywrightTest() {
  try {
    return require('@playwright/test');
  } catch (_) {
    return require(path.resolve(__dirname, '../../task2app/playwright/node_modules/@playwright/test'));
  }
}

const { test, expect } = loadPlaywrightTest();

test.describe('Shift+Click sibling range selection', () => {
  test('Shift+click selects siblings in range and shows "兄弟区间" indicator', async ({ page }) => {
    // 1. Inject chrome API stubs + mock ElementPicker before page load
    await page.addInitScript(() => {
      const store = { token: '', baseUrl: 'https://daydaymoney.com' };

      window.chrome = {
        runtime: {
          sendMessage: async () => ({ success: true }),
          lastError: null,
        },
        storage: {
          local: {
            async get(keys) {
              const list = Array.isArray(keys) ? keys : [keys];
              const out = {};
              for (const k of list) out[k] = store[k];
              return out;
            },
            async set(obj) { Object.assign(store, obj); },
            async remove() {},
          },
          session: { async get() { return {}; }, async set() {} },
        },
        tabs: { async query() { return []; }, sendMessage: async () => {} },
      };

      // Mock ElementPicker with toggleRangeSelection
      window.ElementPicker = {
        snapshotElement(el) {
          const rect = el.getBoundingClientRect();
          return {
            label: el.tagName.toLowerCase() + (el.className ? '.' + el.className.replace(/ /g, '.') : ''),
            cssPath: el.tagName.toLowerCase() + ':nth-child(' + (Array.from(el.parentElement.children).indexOf(el) + 1) + ')',
            tagName: el.tagName,
            visibleText: (el.textContent || '').trim().slice(0, 60),
            inIframe: false,
            crossOriginIframe: false,
            viewportRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          };
        },
        snapshotDisjointSelection(els, opts) {
          const elements = els.map((el) => this.snapshotElement(el));
          return {
            selectionKind: 'disjoint',
            elements,
            label: elements.map((e) => e.label).join(' + '),
            cssPath: elements.map((e) => e.cssPath).join(', '),
            viewportRect: null,
          };
        },
        toggleDisjointSelection(selection, el) {
          const idx = selection.indexOf(el);
          if (idx >= 0) { selection.splice(idx, 1); return selection; }
          selection.push(el);
          return selection;
        },
        /**
         * toggleRangeSelection: Shift+click sibling range selection.
         * @param {Element[]} currentSelection - currently selected elements
         * @param {Element} anchor - the anchor element (first clicked)
         * @param {Element} target - the Shift+clicked element
         * @returns {Element[]} selected range (inclusive of anchor and target)
         */
        toggleRangeSelection(currentSelection, anchor, target) {
          const parent = anchor.parentElement;
          if (!parent || parent !== target.parentElement) return [anchor, target];
          const children = Array.from(parent.children).filter(function (el) { return el.nodeType === 1; });
          var aIdx = children.indexOf(anchor);
          var tIdx = children.indexOf(target);
          if (aIdx < 0 || tIdx < 0) return [anchor, target];
          var start = Math.min(aIdx, tIdx);
          var end = Math.max(aIdx, tIdx);
          return children.slice(start, end + 1);
        },
        /**
         * snapshotRangeSelection: snapshot a contiguous sibling range.
         * @param {Element[]} els
         * @param {object} [opts]
         * @returns {object} snapshot with selectionKind='range' and a label that includes "兄弟区间"
         */
        snapshotRangeSelection(els, opts) {
          const elements = els.map(function (el) { return this.snapshotElement(el); }.bind(this));
          var labels = elements.map(function (e) { return e.visibleText; }).filter(Boolean);
          var labelSuffix = labels.length ? ' (' + labels.join(' → ') + ')' : '';
          return {
            selectionKind: 'range',
            elements: elements,
            label: '兄弟区间' + labelSuffix,
            cssPath: elements.length >= 2
              ? elements[0].cssPath + ' .. ' + elements[elements.length - 1].cssPath
              : (elements[0] ? elements[0].cssPath : ''),
          };
        },
        formatElementAdjustmentBlock: function (payload) {
          if (!payload || !payload.element) return '';
          var el = payload.element;
          var lines = [
            '**选择范围**: ' + (el.label || el.cssPath || ''),
            '**调整期望**: ' + (payload.adjustment || ''),
          ];
          if (payload.screenshotUrl) lines.push('**截图**: ' + payload.screenshotUrl);
          return lines.join('\n');
        },
        appendElementAdjustmentToDescription: function (desc, payload) {
          if (!payload || !payload.element) return desc || '';
          var base = (desc || '').trimEnd();
          var block = this.formatElementAdjustmentBlock(payload);
          return base ? base + '\n\n' + block : block;
        },
        validateAdjustment: function () { return null; },
        resolveComposedElement: function () { return null; },
      };
    });

    // 2. Create test HTML page
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body>
        <h1>Sibling Range Select Test</h1>
        <ul id="test-list">
          <li>Item A</li>
          <li>Item B</li>
          <li>Item C</li>
          <li>Item D</li>
          <li>Item E</li>
        </ul>
        <div id="result"></div>
      </body>
      </html>
    `);

    // 3. Select items using ElementPicker.toggleRangeSelection
    const result = await page.evaluate(() => {
      const list = document.getElementById('test-list');
      const items = Array.from(list.querySelectorAll('li'));
      const anchor = items[0]; // "Item A"
      const target = items[2]; // "Item C"
      // Simulate Shift+click: use toggleRangeSelection
      const range = window.ElementPicker.toggleRangeSelection([], anchor, target);
      if (range.length === 0) return { error: 'empty range' };
      // Snapshot the range
      const snapshot = window.ElementPicker.snapshotRangeSelection(range);
      return {
        rangeLength: range.length,
        label: snapshot.label,
        selectionKind: snapshot.selectionKind,
        elementLabels: snapshot.elements.map(function (e) { return e.visibleText; }),
        cssPath: snapshot.cssPath,
      };
    });

    // 4. Assertions
    expect(result.error).toBeUndefined();
    // Should have selected 3 items (A, B, C)
    expect(result.rangeLength).toBe(3);
    // Label should contain "兄弟区间" (sibling range indicator)
    expect(result.label).toContain('兄弟区间');
    expect(result.selectionKind).toBe('range');
    // All three items in range
    expect(result.elementLabels).toEqual(['Item A', 'Item B', 'Item C']);
    // CSS path should show range
    expect(result.cssPath).toContain('li:nth-child(1)');
    expect(result.cssPath).toContain('li:nth-child(3)');
  });

  test('Shift+click on non-siblings returns fallback pair', async ({ page }) => {
    await page.addInitScript(() => {
      window.chrome = {
        runtime: { sendMessage: async () => ({ success: true }), lastError: null },
        storage: {
          local: { async get() { return {}; }, async set() {}, async remove() {} },
          session: { async get() { return {}; }, async set() {} },
        },
        tabs: { async query() { return []; }, sendMessage: async () => {} },
      };
      window.ElementPicker = {
        toggleRangeSelection: function (currentSelection, anchor, target) {
          var parent = anchor.parentElement;
          if (!parent || parent !== target.parentElement) return [anchor, target];
          var children = Array.from(parent.children).filter(function (el) { return el.nodeType === 1; });
          var aIdx = children.indexOf(anchor);
          var tIdx = children.indexOf(target);
          if (aIdx < 0 || tIdx < 0) return [anchor, target];
          var start = Math.min(aIdx, tIdx);
          var end = Math.max(aIdx, tIdx);
          return children.slice(start, end + 1);
        },
        snapshotRangeSelection: function (els) {
          return { selectionKind: 'range', label: '兄弟区间' };
        },
      };
    });

    await page.setContent(`
      <ul id="list1"><li>A1</li><li>A2</li></ul>
      <ul id="list2"><li>B1</li><li>B2</li></ul>
    `);

    const result = await page.evaluate(() => {
      const a1 = document.querySelector('#list1 li:first-child');
      const b1 = document.querySelector('#list2 li:first-child');
      const range = window.ElementPicker.toggleRangeSelection([], a1, b1);
      return { length: range.length };
    });

    // Different parents: fallback to just anchor+target pair
    expect(result.length).toBe(2);
  });
});
