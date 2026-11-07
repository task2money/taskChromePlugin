'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('user-guide-en-sections', () => {
  it('英文使用说明写明快捷键区默认收起与 ⚠️ 徽标', () => {
    const { STEPS_EN } = require('../lib/user-guide-en-sections.js');
    const steps = STEPS_EN['keyboard-shortcuts']('Alt+X');
    const blob = steps.join('\n');
    assert.match(blob, /Shortcuts stays collapsed by default/);
    assert.match(blob, /⚠️ badge/);
  });

  it('英文使用说明写明超长深链不截断', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../lib/user-guide-en-sections.js'),
      'utf8',
    );
    assert.match(src, /Text over the deeplink URL limit is not truncated; suggestions are forwarded in batches/);
    assert.equal(src.includes('native bridge'), false);
  });
});

describe('user-guide-en-sections 侧栏页签名', () => {
  it('英文使用说明按 Edge compute 页签名指路', () => {
    const { STEPS_EN } = require('../lib/user-guide-en-sections.js');
    const blob = STEPS_EN['builtin-edge-sell'].join('\n');
    assert.match(blob, /Edge compute side-panel tab/);
    assert.match(blob, /in the Edge compute tab/);
    assert.doesNotMatch(blob, /On-device model \(edge compute\)/);
  });
});
