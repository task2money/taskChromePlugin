'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('sw-messages-session getOwnAgents', () => {
  it('delegates getOwnAgents to handleGetOwnAgents', () => {
    const src = fs.readFileSync(path.join(__dirname, '../background/sw-messages-session.js'), 'utf8');
    assert.match(src, /case 'getOwnAgents'/);
    assert.match(src, /handleGetOwnAgents\(message\)/);
  });
});
