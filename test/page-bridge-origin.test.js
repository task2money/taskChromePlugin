'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pageBridge = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'page-bridge.js'),
  'utf8',
);
const panelCore = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'lib', 'panel-core.js'),
  'utf8',
);

describe('postMessage origin checks (javascript:S2819)', () => {
  it('page-bridge 在 addEventListener(message) 回调内校验 origin', () => {
    const listeners = [...pageBridge.matchAll(
      /addEventListener\(\s*'message',\s*function\s*\(\s*event\s*\)\s*\{([\s\S]*?)\},\s*false\)/g,
    )];
    assert.equal(listeners.length, 1, 'expected one message listener');
    for (const m of listeners) {
      assert.match(m[1], /event\.origin\s*!==\s*window\.location\.origin/);
    }
  });

  it('panel-core bindRequestMessagePipeline 校验 event.origin', () => {
    assert.match(
      panelCore,
      /addEventListener\(\s*'message',\s*\(event\)\s*=>\s*\{[\s\S]*?event\.origin\s*!==\s*window\.location\.origin/,
    );
  });
});
