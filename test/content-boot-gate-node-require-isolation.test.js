'use strict';

/**
 * OPT-20261008-011：node --test 同进程加载多个插件用例时，boot gate 不得把
 * globalThis.__taskpluginContentBoot 转入 skip —— 否则随后 require 的 lib/*.js
 * 会跳过 IIFE，module.exports 保持空对象（Delivery.chooseDeliveryPreference is not a function）。
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GATE = path.join(ROOT, 'lib/content-boot-gate.js');
const DELIVERY = path.join(ROOT, 'lib/page-advisor-delivery.js');

function freshRequire(abs) {
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

describe('Node require 下的 boot skip 隔离', () => {
  beforeEach(() => {
    delete globalThis.__taskpluginContentBoot;
    delete globalThis.PageAdvisorDelivery;
    delete require.cache[require.resolve(GATE)];
    delete require.cache[require.resolve(DELIVERY)];
  });

  it('同进程二次加载 gate 不置 skip', () => {
    require(GATE);
    assert.equal(globalThis.__taskpluginContentBoot.skip, false);
    freshRequire(GATE);
    assert.equal(globalThis.__taskpluginContentBoot.skip, false, 'Node 下不得转入 skip');
  });

  it('gate 二次加载后 require delivery 仍导出完整 API', () => {
    require(GATE);
    freshRequire(GATE);
    const Delivery = freshRequire(DELIVERY);
    assert.equal(typeof Delivery.chooseDeliveryPreference, 'function');
    assert.equal(typeof Delivery.buildIdeDeeplink, 'function');
  });
});
