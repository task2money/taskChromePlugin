'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

describe('service-worker', () => {
  it('importScripts 含本机出售重装恢复模块', () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'background/service-worker.js'), 'utf8');
    const recover = sw.indexOf('../lib/builtin-edge-registration-recover.js');
    const join = sw.indexOf('../lib/builtin-edge-node-join.js');
    const tunnel = sw.indexOf('../lib/builtin-edge-tunnel.js');
    assert.ok(recover >= 0, 'missing recover import');
    assert.ok(join > recover, 'recover must load before node-join consumers');
    assert.ok(tunnel > join);
  });

  it('importScripts 含 builtin enable 等待与看门狗', () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'background/service-worker.js'), 'utf8');
    const enableLib = sw.indexOf('../lib/page-advisor-builtin-enable.js');
    const prompt = sw.indexOf('../lib/page-advisor-builtin-prompt.js');
    const watchdog = sw.indexOf('./sw-builtin-enable-watchdog.js');
    assert.ok(prompt >= 0);
    assert.ok(enableLib > prompt);
    assert.ok(watchdog > enableLib);
  });
});
