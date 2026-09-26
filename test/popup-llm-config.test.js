'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('popup LLM draft restore', () => {
  it('writes the draft on each input and restores it expanded', () => {
    const src = fs.readFileSync(path.join(__dirname, '../popup/popup-llm-config.js'), 'utf8');
    assert.match(src, /saveDraftToStorage/);
    assert.match(src, /loadDraftFromStorage/);
    assert.match(src, /shouldRestoreDraft/);
    assert.match(src, /clearDraftFromStorage/);
    assert.match(src, /addEventListener\('input'/);
    assert.match(src, /pagehide/);
    assert.match(src, /if \(!routeUiReady\) return/);
    assert.match(src, /setLlmSettingsExpanded\([\s\S]*restore/);
  });
});
