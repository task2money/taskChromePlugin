'use strict';

/**
 * OPT-20260914-012 — DevTools panel 使用说明样式与 popup/content 对齐。
 *
 * panel/lib/panel-core.js 挂载 UserGuide.renderFullGuideHtml({ surface: 'panel' })，
 * 故 panel.css 必须覆盖该渲染产物实际输出的全部 tcp-guide-* class。
 * 本测试以渲染产物为 SSOT 派生断言，新增 guide 结构而漏配样式即失败。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const UserGuide = require('../lib/user-guide.js');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/** Guide class tokens emitted for the DevTools panel surface. */
function panelGuideClasses() {
  const html = UserGuide.renderFullGuideHtml({ surface: 'panel' });
  const tokens = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const t of m[1].split(/\s+/)) {
      if (t.startsWith('tcp-guide') || t === 'sr-only') tokens.add(t);
    }
  }
  return [...tokens].sort();
}

describe('panel.css styles the rendered panel guide', () => {
  it('renders guide markup with the a11y structure panel.js mounts', () => {
    const classes = panelGuideClasses();
    // Sanity: guard against a vacuous pass if the renderer regresses to empty.
    assert.ok(classes.includes('tcp-guide-full'), 'expected tcp-guide-full in panel guide');
    assert.ok(classes.includes('tcp-guide-kbd'), 'expected tcp-guide-kbd in panel guide');
    assert.ok(classes.includes('sr-only'), 'expected sr-only (table caption) in panel guide');
    assert.ok(classes.length >= 10, `expected >=10 guide classes, got ${classes.length}`);
  });

  it('has a CSS rule for every class the panel guide renders', () => {
    const css = read('panel/panel.css');
    const missing = panelGuideClasses().filter((c) => !css.includes(`.${c}`));
    assert.deepEqual(
      missing,
      [],
      `panel/panel.css is missing styles for: ${missing.join(', ')}`,
    );
  });

  it('does not keep dead <details>/<summary> guide styling', () => {
    // renderFullGuideHtml emits <section>/<h4>, never <details>/<summary>;
    // the old .tcp-guide-summary / -webkit-details-marker rules must not linger.
    const css = read('panel/panel.css');
    assert.doesNotMatch(css, /-webkit-details-marker/);
    assert.doesNotMatch(css, /\.tcp-guide-summary\b/);
  });

  it('keyboard shortcut table renders as a table, not a bullet list', () => {
    const css = read('panel/panel.css');
    assert.match(css, /\.tcp-guide-shortcut-table\s*\{[^}]*border-collapse/);
    assert.match(css, /\.tcp-guide-shortcut-table th/);
  });
});
