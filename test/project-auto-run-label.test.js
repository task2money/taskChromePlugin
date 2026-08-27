'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  projectDisplayName,
  projectAllowsAutoRun,
  projectAutoRunBadgeText,
  formatProjectListLabel,
  renderProjectCheckboxCaptionHtml,
} = require('../lib/project-auto-run-label.js');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const allowed = {
  id: 'p1',
  name: 'Alpha',
  server_run_template: { default_auto_run: true, platform: 'aliyun' },
};

describe('projectAllowsAutoRun', () => {
  it('T1 true when default_auto_run is boolean true', () => {
    assert.equal(projectAllowsAutoRun(allowed), true);
    assert.equal(projectAutoRunBadgeText(allowed), '可自动运行');
  });

  it('T2 false when default_auto_run is false', () => {
    const p = { id: 'p2', name: 'Beta', server_run_template: { default_auto_run: false } };
    assert.equal(projectAllowsAutoRun(p), false);
    assert.equal(projectAutoRunBadgeText(p), '不可自动运行');
  });

  it('T3 false when server_run_template missing', () => {
    assert.equal(projectAllowsAutoRun({ id: 'p3', name: 'Gamma' }), false);
    assert.equal(projectAllowsAutoRun(null), false);
    assert.equal(projectAllowsAutoRun(undefined), false);
  });

  it('T4 false when template is array or non-object', () => {
    assert.equal(projectAllowsAutoRun({ server_run_template: [] }), false);
    assert.equal(projectAllowsAutoRun({ server_run_template: 'yes' }), false);
    assert.equal(projectAllowsAutoRun({ server_run_template: { default_auto_run: 'true' } }), false);
    assert.equal(projectAllowsAutoRun({ server_run_template: { default_auto_run: 1 } }), false);
  });
});

describe('formatProjectListLabel', () => {
  it('T6 puts badge in parentheses next to name', () => {
    assert.equal(formatProjectListLabel(allowed), 'Alpha（可自动运行）');
    assert.equal(
      formatProjectListLabel({ id: 'x', name: 'Zed' }),
      'Zed（不可自动运行）',
    );
  });

  it('uses displayName / title / id fallback', () => {
    assert.equal(projectDisplayName({ displayName: 'D' }), 'D');
    assert.equal(projectDisplayName({ title: 'T' }), 'T');
    assert.equal(projectDisplayName({ id: 'id-9' }), 'id-9');
  });
});

describe('renderProjectCheckboxCaptionHtml', () => {
  it('T5 escapes project name', () => {
    const html = renderProjectCheckboxCaptionHtml(
      { id: 'evil', name: '<script>x</script>', server_run_template: { default_auto_run: true } },
      esc,
    );
    assert.equal(html.includes('<script>'), false);
    assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
    assert.match(html, /data-auto-run="true"/);
    assert.match(html, /可自动运行/);
  });

  it('sets data-auto-run false when not allowed', () => {
    const html = renderProjectCheckboxCaptionHtml({ id: 'n', name: 'Nope' }, esc);
    assert.match(html, /data-auto-run="false"/);
    assert.match(html, /不可自动运行/);
  });
});

describe('injection and usage contracts', () => {
  it('T7 float and panel render via ProjectAutoRunLabel', () => {
    const content = read('content/content.js');
    const workspace = read('panel/lib/workspace.js');
    assert.match(content, /ProjectAutoRunLabel\.renderProjectCheckboxCaptionHtml/);
    assert.match(workspace, /ProjectAutoRunLabel\.renderProjectCheckboxCaptionHtml/);
  });

  it('T8 manifest and panel.html load lib before consumers', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const scripts = manifest.content_scripts[0].js;
    const libIdx = scripts.indexOf('lib/project-auto-run-label.js');
    const contentIdx = scripts.indexOf('content/content.js');
    assert.ok(libIdx >= 0, 'manifest must inject project-auto-run-label.js');
    assert.ok(libIdx < contentIdx, 'lib must load before content.js');

    const panelHtml = read('panel/panel.html');
    const libPos = panelHtml.indexOf('lib/project-auto-run-label.js');
    const wsPos = panelHtml.indexOf('lib/workspace.js');
    assert.ok(libPos >= 0, 'panel.html must load project-auto-run-label.js');
    assert.ok(wsPos > libPos, 'label lib must load before workspace.js');
  });

  it('T9 user guide mentions auto-run badges', () => {
    assert.match(read('docs/USER_GUIDE.md'), /可自动运行/);
    assert.match(read('lib/user-guide.js'), /可自动运行/);
  });
});
