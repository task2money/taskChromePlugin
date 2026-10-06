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
    const lang = sw.indexOf('../lib/page-advisor-builtin-language.js');
    const fit = sw.indexOf('../lib/page-advisor-builtin-fit.js');
    const prog = sw.indexOf('../lib/page-advisor-builtin-progress.js');
    const prompt = sw.indexOf('../lib/page-advisor-builtin-prompt.js');
    assert.ok(lang >= 0);
    assert.ok(fit > lang);
    assert.ok(prog > fit);
    assert.ok(prompt > prog);
    const watchdog = sw.indexOf('./sw-builtin-enable-watchdog.js');
    assert.ok(prompt >= 0);
    assert.ok(enableLib > prompt);
    assert.ok(watchdog > enableLib);
  });

  it('importScripts 含 popup-system-sku 与 getOwnAgents', () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'background/service-worker.js'), 'utf8');
    const menu = sw.indexOf('../lib/popup-system-sku.js');
    const own = sw.indexOf('./sw-messages-own-agents.js');
    const session = sw.indexOf('./sw-messages-session.js');
    assert.ok(menu >= 0);
    assert.ok(own > menu);
    assert.ok(session > own);
  });
});
