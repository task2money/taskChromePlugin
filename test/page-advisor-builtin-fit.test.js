'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fit = require('../lib/page-advisor-builtin-fit.js');

test('inputBudget 为输出预留约 35% 配额', () => {
  assert.equal(fit.inputBudget(1000), 650);
  assert.equal(fit.inputBudget(Infinity), Infinity);
});

test('resolveUsage 会解开 Promise，避免同步比较永远跳过压缩', async () => {
  assert.equal(await fit.resolveUsage(Promise.resolve(42)), 42);
  assert.equal(await fit.resolveUsage(7), 7);
});

test('shrinkPage 在异步 measure 下仍截断超长正文', async () => {
  const page = { pageText: '字'.repeat(2000), domOutline: [{ nid: 'keep', tag: 'button' }] };
  const out = await fit.shrinkPage(page, async (p) => Array.from(p.pageText || '').length, 200);
  assert.ok(out.usage <= 200);
  assert.ok(Array.from(out.page.pageText).length <= 200);
});
