'use strict';

/**
 * 深链分批共用核心（OPT-20261011-045）。
 *
 * 插件与 taskFE 的评论唤醒按同一个 7500 上限、同一组协议前缀切开正文；核心
 * 被改坏时两边会一起坏，所以把「放不下就按字符切开、一个字都不丢」锁在这里。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Core = require('../lib/deeplink-core.js');

/** 按核心给出的最长长度反复切片，直到切完；返回每一段。 */
function sliceAll(target, text) {
  const slices = [];
  let rest = String(text || '');
  let guard = 0;
  while (rest && guard < 10000) {
    guard += 1;
    let n = Core.maxFittingChars(rest, (slice) => Core.promptFitsDeeplink(target, slice));
    if (n < 1) n = 1;
    slices.push(rest.slice(0, n));
    rest = rest.slice(n);
  }
  return slices;
}

describe('deeplink-core', () => {
  it('只有三个有官方深链的目标，其余没有前缀', () => {
    assert.match(Core.deeplinkPrefix('cursor'), /^cursor:\/\/anysphere\.cursor-deeplink\/prompt\?text=$/);
    assert.match(Core.deeplinkPrefix('claude'), /^claude:\/\/code\/new\?q=$/);
    assert.match(Core.deeplinkPrefix('codex'), /^codex:\/\/new\?prompt=$/);
    assert.equal(Core.deeplinkPrefix('task_description'), '');
    assert.equal(Core.deeplinkPrefix('nope'), '');
    assert.equal(Core.deeplinkPrefix(null), '');
  });

  it('空正文不算放得下，放得下的判定按编码后的长度', () => {
    assert.equal(Core.promptFitsDeeplink('cursor', ''), false);
    assert.equal(Core.promptFitsDeeplink('task_description', '正文'), false);
    assert.equal(Core.promptFitsDeeplink('cursor', '短正文'), true);
    const prefix = Core.deeplinkPrefix('cursor');
    const almost = 'x'.repeat(Core.DEEPLINK_MAX_URL_LEN - prefix.length);
    assert.equal(Core.promptFitsDeeplink('cursor', almost), true);
    assert.equal(Core.promptFitsDeeplink('cursor', almost + 'x'), false);
  });

  it('内容前缀超长截断，换行折成空格', () => {
    assert.equal(Core.normalizeContentPrefix('  /goal  '), '/goal');
    assert.equal(Core.normalizeContentPrefix('/goal\n第二行'), '/goal 第二行');
    assert.equal(Core.normalizeContentPrefix(null), '');
    const long = '前'.repeat(Core.CONTENT_PREFIX_MAX_LEN + 50);
    assert.equal(Core.normalizeContentPrefix(long).length, Core.CONTENT_PREFIX_MAX_LEN);
  });

  it('超长中文切开后拼回原文，每段编码后都不超过上限', () => {
    const body = '优化结果：把首页标题改成一句话。'.repeat(400);
    const slices = sliceAll('cursor', body);
    assert.ok(slices.length > 1, '长正文必须切成多段');
    assert.equal(slices.join(''), body, '切开后拼回必须与原正文一致');
    const prefix = Core.deeplinkPrefix('cursor');
    for (const slice of slices) {
      assert.ok(
        prefix.length + encodeURIComponent(slice).length <= Core.DEEPLINK_MAX_URL_LEN,
        '每一段都要放得进一条深链',
      );
    }
  });

  it('不切开代理对：emoji 不会被劈成半个字符', () => {
    const body = '🚀'.repeat(4000);
    const slices = sliceAll('codex', body);
    assert.equal(slices.join(''), body);
    for (const slice of slices) {
      const first = slice.charCodeAt(0);
      const last = slice.charCodeAt(slice.length - 1);
      assert.ok(!(first >= 0xDC00 && first <= 0xDFFF), '段首不能是低位代理');
      assert.ok(!(last >= 0xD800 && last <= 0xDBFF), '段尾不能是高位代理');
    }
  });
});
