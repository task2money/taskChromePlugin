'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('sidebar suggestion cards match Alt+Z', () => {
  it('selected sticker renders the Alt+Z cards without an adopt bar', () => {
    const show = fs.readFileSync(
      path.join(__dirname, '..', 'content', 'float-page-advisor-site-pending.js'),
      'utf8',
    );
    const cards = fs.readFileSync(
      path.join(__dirname, '..', 'content', 'float-page-advisor.js'),
      'utf8',
    );
    assert.match(show, /showPageAdvisorSuggestions\(\{\s*suggestions: post\.suggestions,\s*pageUrl,\s*\}\)/);
    assert.doesNotMatch(show, /sitePending:/);
    assert.doesNotMatch(show, /buildSitePendingDecisionHtml/);
    assert.doesNotMatch(cards, /buildSitePendingDecisionHtml/);
    assert.doesNotMatch(cards, /taskplugin-page-advisor-site-actions/);
  });
});
