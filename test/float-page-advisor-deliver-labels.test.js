'use strict';

/**
 * 回归：IDE 转发目标下底栏按钮须显示「发送到 {name}」，不得显示裸 key。
 * 文案键随 popup 文案包注入 content_scripts（旧 LLM 路由文案包已删除）。
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

  it('deliver 底栏取词键与 popup 文案包一致，且不得回退成裸 key', () => {
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

  it('送达说明与分批提示保留原文（搬迁后内容不变）', () => {
    assert.equal(
      i18n.t('paDeliverBatched', { count: 3, name: 'Cursor' }),
      '已把建议分成 3 批打开 Cursor，每批都可单独应用。',
    );
    assert.match(i18n.t('paDeliveryHint'), /「转发目标」一次只选一个/);
    assert.match(i18n.t('paDeliveryHint'), /正文超过深链 URL 上限时不截断/);

    i18n.setLocale('en');
    assert.equal(
      i18n.t('paDeliverBatched', { count: 3, name: 'Cursor' }),
      'Opened Cursor in 3 batches. Apply each batch on its own.',
    );
    assert.match(i18n.t('paDeliveryHint'), /forwarded in batches/);
    i18n.setLocale('zh-CN');
  });
});
