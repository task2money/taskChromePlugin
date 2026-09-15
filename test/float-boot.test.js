'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('float-boot 负责人控件绑定', () => {
  it('声明 ownerSelect = taskplugin-owner', () => {
    const src = fs.readFileSync(path.join(root, 'content', 'float-boot.js'), 'utf8');
    assert.match(src, /ownerSelect\s*=\s*document\.getElementById\('taskplugin-owner'\)/);
  });
});
