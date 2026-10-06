'use strict';

/**
 * OPT-20261006-023：系统智能体 SKU 次数用尽须与自有转发次数区分；
 * 若复用 402 的 AUTO_INNOVATE 引导，已选系统购买的用户会被引去买错资源。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('系统智能体次数用尽引导', () => {
  it('service worker 先分流 SYS_AUTO_INNOVATE_QUOTA_EXCEEDED 再落到通用 402', () => {
    const sw = read('background/sw-page-advisor.js');
    assert.match(sw, /function sysAutoInnovateQuotaExceededMessage/);
    assert.match(sw, /errorCode: 'SYS_AUTO_INNOVATE_QUOTA_EXCEEDED'/);
    const sysIdx = sw.indexOf("e?.errorCode === 'SYS_AUTO_INNOVATE_QUOTA_EXCEEDED'");
    const genericIdx = sw.indexOf("e?.status === 402 || e?.errorCode === 'AUTO_INNOVATE_QUOTA_EXCEEDED'");
    assert.ok(sysIdx >= 0, '缺少系统 SKU 错误码分流');
    assert.ok(genericIdx >= 0, '缺少通用 402 分流');
    assert.ok(sysIdx < genericIdx, '系统 SKU 分流必须早于通用 402，否则 SYS 码会被 402 抢先');
  });

  it('新增 i18n 键中英齐备', () => {
    const i18n = read('lib/i18n-llm-route.js');
    for (const key of ['paSysQuotaExhausted', 'paBuySystemAgent']) {
      const hits = i18n.match(new RegExp(`${key}:`, 'g')) || [];
      assert.ok(hits.length >= 2, `${key} 需中英双语，实际 ${hits.length}`);
    }
  });

  it('系统 SKU 引导链接到设置页而非下单页', () => {
    const sw = read('background/sw-page-advisor.js');
    const fnAt = sw.indexOf('function sysAutoInnovateQuotaExceededMessage');
    const body = sw.slice(fnAt, sw.indexOf('\n}', fnAt));
    assert.match(body, /settings\/feature-params\//);
    assert.match(body, /paBuySystemAgent/);
  });
});
