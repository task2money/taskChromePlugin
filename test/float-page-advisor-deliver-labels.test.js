'use strict';

/**
 * 回归：IDE 转发目标下底栏按钮须显示「发送到 {name}」，不得显示裸 key。
 * 根因曾是 content_scripts 未注入 i18n-llm-route.js。
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { loadContentScriptMessageTables } = require('./helpers/i18nScan.js');

describe('applyPageAdvisorDeliveryButtonLabels i18n', () => {
  let i18n;

  before(() => {
    loadContentScriptMessageTables();
    i18n = require(path.join(ROOT, 'lib/i18n.js'));
    i18n.setLocale('zh-CN');
  });

  it('cs0 文案表含 paDeliverAgainOne/All 且可插值', () => {
    assert.equal(i18n.t('paDeliverAgainAll', { name: 'Cursor' }), '发送到 Cursor');
    assert.equal(i18n.t('paDeliverAgainOne', { name: 'Cursor' }), '发送一条到 Cursor');
    i18n.setLocale('en');
    assert.equal(i18n.t('paDeliverAgainAll', { name: 'Cursor' }), 'Send to Cursor');
    assert.equal(i18n.t('paDeliverAgainOne', { name: 'Cursor' }), 'Send one to Cursor');
    i18n.setLocale('zh-CN');
  });

  it('deliver 底栏取词键与 i18n-llm-route 一致，且不得回退成裸 key', () => {
    const deliverSrc = fs.readFileSync(
      path.join(ROOT, 'content/float-page-advisor-deliver.js'),
      'utf8',
    );
    assert.match(deliverSrc, /tx\("paDeliverAgainAll"/);
    assert.match(deliverSrc, /tx\("paDeliverAgainOne"/);
    const labelAll = i18n.t('paDeliverAgainAll', { name: 'Claude' });
    const labelOne = i18n.t('paDeliverAgainOne', { name: 'Claude' });
    assert.notEqual(labelAll, 'paDeliverAgainAll');
    assert.notEqual(labelOne, 'paDeliverAgainOne');
    assert.match(labelAll, /Claude/);
    assert.match(labelOne, /Claude/);
  });
});
