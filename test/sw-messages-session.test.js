'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('sw-messages-session 智能体消息', () => {
  it('delegates getOwnAgents to handleGetOwnAgents', () => {
    const src = fs.readFileSync(path.join(__dirname, '../background/sw-messages-session.js'), 'utf8');
    assert.match(src, /case 'getOwnAgents'/);
    assert.match(src, /handleGetOwnAgents\(message\)/);
  });

  it('getSystemAgents 已随 popup 智能体下拉下线', () => {
    const src = fs.readFileSync(path.join(__dirname, '../background/sw-messages-session.js'), 'utf8');
    assert.doesNotMatch(src, /case 'getSystemAgents'/);
    assert.doesNotMatch(src, /listTenantSystemAgents/);
    assert.doesNotMatch(src, /getTenantBillingQuotas/);
    assert.doesNotMatch(src, /mergeSystemSkuRemaining/);
  });
});
