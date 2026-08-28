'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  isWorkspaceAutoScheduleEnabled,
  shouldShowCreateTaskQueuedAutoRun,
  resolveQueuedAutoRunHint,
  appendQueuedAutoRunToCreatePayload,
  applyCreateTaskQueuedVisibility,
  showFetchError,
  clearFetchError,
} = require('../lib/workspace-auto-schedule.js');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('isWorkspaceAutoScheduleEnabled', () => {
  it('true only when schedule_rhythm.enabled is boolean true', () => {
    assert.equal(isWorkspaceAutoScheduleEnabled({ schedule_rhythm: { enabled: true } }), true);
    assert.equal(isWorkspaceAutoScheduleEnabled({ schedule_rhythm: { enabled: false } }), false);
    assert.equal(isWorkspaceAutoScheduleEnabled({ schedule_rhythm: null }), false);
    assert.equal(isWorkspaceAutoScheduleEnabled({}), false);
    assert.equal(isWorkspaceAutoScheduleEnabled(null), false);
  });
});

describe('shouldShowCreateTaskQueuedAutoRun', () => {
  it('requires auto-run allowed, checked, and workspace schedule enabled', () => {
    assert.equal(shouldShowCreateTaskQueuedAutoRun({
      canEnableAutoRun: true,
      autoRun: true,
      workspaceScheduleEnabled: true,
    }), true);
    assert.equal(shouldShowCreateTaskQueuedAutoRun({
      canEnableAutoRun: true,
      autoRun: true,
      workspaceScheduleEnabled: false,
    }), false);
    assert.equal(shouldShowCreateTaskQueuedAutoRun({
      canEnableAutoRun: true,
      autoRun: false,
      workspaceScheduleEnabled: true,
    }), false);
    assert.equal(shouldShowCreateTaskQueuedAutoRun({
      canEnableAutoRun: false,
      autoRun: true,
      workspaceScheduleEnabled: true,
    }), false);
  });
});

describe('appendQueuedAutoRunToCreatePayload', () => {
  it('sets queued_auto_run only when auto_run is true', () => {
    assert.deepEqual(
      appendQueuedAutoRunToCreatePayload({}, { auto_run: true, queued_auto_run: true }),
      { queued_auto_run: true },
    );
    assert.deepEqual(
      appendQueuedAutoRunToCreatePayload({}, { auto_run: true, queued_auto_run: false }),
      { queued_auto_run: false },
    );
    assert.deepEqual(
      appendQueuedAutoRunToCreatePayload({ title: 't' }, { auto_run: false, queued_auto_run: true }),
      { title: 't' },
    );
  });
});

describe('resolveQueuedAutoRunHint', () => {
  it('explains queue vs immediate start', () => {
    const hint = resolveQueuedAutoRunHint();
    assert.match(hint, /不立即启服/);
    assert.match(hint, /自动调度/);
  });
});

describe('applyCreateTaskQueuedVisibility', () => {
  it('hides wrap and unchecks input when not shown', () => {
    const wrapEl = { hidden: false };
    const inputEl = { checked: true };
    applyCreateTaskQueuedVisibility({ wrapEl, inputEl, show: false });
    assert.equal(wrapEl.hidden, true);
    assert.equal(inputEl.checked, false);
    applyCreateTaskQueuedVisibility({ wrapEl, inputEl, show: true });
    assert.equal(wrapEl.hidden, false);
  });
});

describe('showFetchError', () => {
  it('writes message and data-traceId', () => {
    const el = { hidden: true, textContent: '', className: 'result', attrs: {} };
    el.setAttribute = (k, v) => { el.attrs[k] = v; };
    el.removeAttribute = (k) => { delete el.attrs[k]; };
    const err = new Error('queue-schedule failed');
    err.traceId = 'trace-abc';
    showFetchError(el, err);
    assert.equal(el.hidden, false);
    assert.equal(el.textContent, 'queue-schedule failed');
    assert.equal(el.attrs['data-traceId'], 'trace-abc');
    assert.match(el.className, /\berror\b/);
    clearFetchError(el);
    assert.equal(el.hidden, true);
    assert.equal(el.textContent, '');
    assert.equal(el.attrs['data-traceId'], undefined);
    assert.doesNotMatch(el.className, /\berror\b/);
  });
});

describe('queued auto-run empty red box must stay hidden', () => {
  it('DevTools panel error nodes are not pre-classed as error', () => {
    const html = read('panel/panel.html');
    assert.match(html, /id="singleQueuedAutoRunError"[^>]*class="result"/);
    assert.match(html, /id="batchQueuedAutoRunError"[^>]*class="result"/);
    assert.doesNotMatch(html, /id="singleQueuedAutoRunError"[^>]*class="result error"/);
    assert.doesNotMatch(html, /id="batchQueuedAutoRunError"[^>]*class="result error"/);
  });

  it('panel.css lets [hidden] win over .result.error display:block', () => {
    const css = read('panel/panel.css');
    assert.match(css, /\.result\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  });
});

describe('plugin surfaces wire queued auto-run', () => {
  it('float markup contains nested queue checkbox', () => {
    const markup = read('lib/float-panel-markup.js');
    assert.match(markup, /id="taskplugin-queued-auto-run"/);
    assert.match(markup, /加入自动调度队列/);
    assert.match(markup, /id="taskplugin-queued-auto-run-error"/);
  });

  it('content.js loads schedule via getQueueSchedule and payload includes queued_auto_run', () => {
    const { readContentBundle } = require('./helpers/contentBundle.js');
    const content = readContentBundle();
    assert.match(content, /getQueueSchedule/);
    assert.match(content, /queued_auto_run:\s*Boolean\(queuedInput/);
    assert.match(content, /syncFloatQueuedAutoRun/);
    assert.match(content, /err\.traceId/);
  });

  it('panel HTML has single and batch queue checkboxes', () => {
    const html = read('panel/panel.html');
    assert.match(html, /id="singleQueuedAutoRun"/);
    assert.match(html, /id="batchQueuedAutoRun"/);
  });

  it('panel refreshRepoBaseEditors fills per-repo branch datalists', () => {
    const workspace = read('panel/lib/workspace.js');
    const branches = read('panel/lib/branches.js');
    assert.match(workspace, /populateRepoBaseBranchDatalists/);
    assert.match(branches, /P\.populateRepoBaseBranchDatalists\s*=\s*async function/);
    assert.match(branches, /getBranches/);
  });

  it('service worker handles getQueueSchedule', () => {
    const { readSWLocalBundle } = require('./helpers/swBundle.js');
    const sw = readSWLocalBundle();
    assert.match(sw, /case 'getQueueSchedule'/);
    assert.match(sw, /queue-schedule/);
  });
});
