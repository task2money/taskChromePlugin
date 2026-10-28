'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('sw-messages-own-agents', () => {
  it('getOwnAgents 契约保留，但不再依赖已删除的弹窗智能体模块', () => {
    const src = fs.readFileSync(path.join(__dirname, '../background/sw-messages-own-agents.js'), 'utf8');
    assert.match(src, /async function handleGetOwnAgents/);
    assert.match(src, /providers: \[\]/);
    assert.doesNotMatch(src, /collectOwnAgentOptions/);
    assert.doesNotMatch(src, /getPersonalFeatureParamsConfigs/);
  });

  it('拉取租户 agent-pref 并带上设置页所需 tenantId/baseUrl', () => {
    const src = fs.readFileSync(path.join(__dirname, '../background/sw-messages-own-agents.js'), 'utf8');
    assert.match(src, /async function handleGetTenantAgentPref/);
    assert.match(src, /getTenantAgentPref/);
    const session = fs.readFileSync(path.join(__dirname, '../background/sw-messages-session.js'), 'utf8');
    assert.match(session, /case 'getTenantAgentPref'/);
  });
});
