'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panelCore = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'lib', 'panel-core.js'),
  'utf8',
);

describe('postMessage origin checks (javascript:S2819)', () => {
  it('panel-core bindRequestMessagePipeline 校验 event.origin', () => {
    assert.match(
      panelCore,
      /addEventListener\(\s*'message',\s*\(event\)\s*=>\s*\{[\s\S]*?event\.origin\s*!==\s*window\.location\.origin/,
    );
  });
});
