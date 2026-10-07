'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('float-pick IDE delivery channel', () => {
  it('确认调整时用 isIdeDeliveryTarget 决定是否深链', () => {
    const pick = fs.readFileSync(path.join(__dirname, '../content/float-pick.js'), 'utf8');
    assert.match(pick, /isIdeDeliveryTarget/);
    assert.match(pick, /deliverPlainTextViaDeliveryTarget/);
    assert.doesNotMatch(pick, /shouldAutoDeliverOnResult/);
  });
});
