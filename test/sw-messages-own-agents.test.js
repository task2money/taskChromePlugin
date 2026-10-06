'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('sw-messages-own-agents', () => {
  it('loads workspace then company then personal summaries', () => {
    const src = fs.readFileSync(path.join(__dirname, '../background/sw-messages-own-agents.js'), 'utf8');
    assert.match(src, /async function handleGetOwnAgents/);
    const ws = src.indexOf('getWorkspaceFeatureParamsSummary');
    const co = src.indexOf('getCompanyFeatureParamsSummary');
    const pe = src.indexOf('getPersonalFeatureParamsConfigs');
    assert.ok(ws >= 0 && co > ws && pe > co);
    assert.match(src, /collectOwnAgentOptions/);
  });
});
