'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

describe('api feature-params summary helpers', () => {
  it('exports company and workspace summary GET', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/api.js'), 'utf8');
    assert.match(src, /function getCompanyFeatureParamsSummary/);
    assert.match(src, /function getWorkspaceFeatureParamsSummary/);
    assert.match(src, /view=summary/);
    assert.match(src, /getCompanyFeatureParamsSummary, getWorkspaceFeatureParamsSummary/);
  });
});
