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

  it('拉取租户 agent-pref 并带上设置页所需 tenantId/baseUrl', () => {
    const src = fs.readFileSync(path.join(__dirname, '../background/sw-messages-own-agents.js'), 'utf8');
    assert.match(src, /async function handleGetTenantAgentPref/);
    assert.match(src, /getTenantAgentPref/);
    assert.match(src, /overlayPageAdvisorTenantPref/);
    const session = fs.readFileSync(path.join(__dirname, '../background/sw-messages-session.js'), 'utf8');
    assert.match(session, /case 'getTenantAgentPref'/);
    const sw = fs.readFileSync(path.join(__dirname, '../background/sw-page-advisor.js'), 'utf8');
    assert.match(sw, /overlayPageAdvisorTenantPref/);
  });
});
