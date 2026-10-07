'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('float-page-advisor-deliver — no auto forward after Alt+Z', () => {
  it('deliver 模块无 maybeAutoDeliver；用 isIdeDeliveryTarget', () => {
    const deliver = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-deliver.js'),
      'utf8',
    );
    assert.doesNotMatch(deliver, /function maybeAutoDeliverPageAdvisorResult/);
    assert.doesNotMatch(deliver, /pageAdvisorAutoDeliveredJobs/);
    assert.match(deliver, /isIdeDeliveryTarget/);
    assert.match(deliver, /deliverPlainTextViaDeliveryTarget/);
  });

  it('建议层展示结果不调用自动送达', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor.js'),
      'utf8',
    );
    assert.doesNotMatch(src, /maybeAutoDeliverPageAdvisorResult/);
    assert.match(src, /须等用户点建议底栏按钮/);
  });
});
