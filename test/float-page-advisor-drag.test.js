'use strict';

/**
 * Alt+Shift+Z 建议层底栏可拖离视口底部，且主按钮 100% 宽不再撑满底栏。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('page advisor toolbar drag', () => {
  it('clamp keeps the bar inside an 8px viewport margin', () => {
    const sandbox = { Math, Number };
    vm.runInNewContext(
      `${read('content/float-page-advisor-drag.js')}\n;`
      + 'this.clampPageAdvisorToolbarBox = clampPageAdvisorToolbarBox;',
      sandbox,
    );
    const pos = sandbox.clampPageAdvisorToolbarBox(-40, 900, 200, 80, {
      width: 400,
      height: 300,
    });
    assert.equal(pos.left, 8);
    assert.equal(pos.top, 212);
  });

  it('double-click resets and keyboard nudge pins the toolbar', () => {
    const src = read('content/float-page-advisor-drag.js');
    assert.match(src, /function bindPageAdvisorToolbarDrag/);
    assert.match(src, /resetPageAdvisorToolbarPosition\(toolbar\)/);
    assert.match(src, /applyPageAdvisorToolbarPosition\(toolbar, rect\.left \+ dx, rect\.top \+ dy\)/);
    assert.match(read('content/float-page-advisor.js'), /bindPageAdvisorToolbarDrag/);
    assert.match(read('lib/page-advisor-a11y.js'), /taskplugin-page-advisor-toolbar-drag/);
    assert.match(read('content/page-advisor.css'), /\.taskplugin-page-advisor-toolbar-drag/);
  });

  it('primary button full width applies only to the float submit button', () => {
    const css = read('content/content-form.css');
    assert.match(css, /#taskplugin-submit\.taskplugin-btn-primary\s*\{[^}]*width:\s*100%/);
    const general = css.match(/\.taskplugin-btn-primary\s*\{[^}]*\}/);
    assert.ok(general, '保留主按钮配色规则');
    assert.doesNotMatch(general[0], /width:\s*100%/);
  });
});
