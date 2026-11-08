'use strict';

/**
 * ADR-0185：插件登录态网页优化改走「自动创新优化」功能包计费。
 *
 * 三件事一起守：
 * 1. 受理 body 显式带 billing_feature_code=auto_optimize（服务端见字段才 plan 包）；
 * 2. 包不覆盖智能体（409）/ 计费不可用（503）分别给出可区分的错误码与文案，
 *    不静默降级成单项计费；
 * 3. 两条新文案中英齐备。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('网页优化功能包计费（ADR-0185）', () => {
  it('登录态受理 body 显式声明 auto_optimize 配方', () => {
    const sw = read('background/sw-page-advisor-generate.js');
    const fnAt = sw.indexOf('async function generateViaPlatform');
    assert.ok(fnAt >= 0, '缺少 generateViaPlatform');
    const bodyAt = sw.indexOf('const body = await withSpan', fnAt);
    const bodyEnd = sw.indexOf('}));', bodyAt);
    const body = sw.slice(bodyAt, bodyEnd);
    assert.match(body, /billing_feature_code:\s*'auto_optimize'/);
  });

  it('匿名试用路径不声明功能包配方（保持原计费）', () => {
    const trial = read('background/sw-page-advisor-page-trial.js');
    assert.doesNotMatch(trial, /billing_feature_code/);
  });

  it('409 PACK_AGENT_NOT_COVERED 与 503 billing_unavailable 分流且保留错误码', () => {
    const sw = read('background/sw-page-advisor-generate.js');
    const fnAt = sw.indexOf('function platformCreateFailure');
    assert.ok(fnAt >= 0, '缺少 platformCreateFailure');
    const fn = sw.slice(fnAt, sw.indexOf('\n}', fnAt));
    const packIdx = fn.indexOf("e?.errorCode === 'PACK_AGENT_NOT_COVERED'");
    const billingIdx = fn.indexOf("e?.errorCode === 'billing_unavailable'");
    const genericIdx = fn.indexOf("e?.status === 402 || e?.errorCode === 'AUTO_INNOVATE_QUOTA_EXCEEDED'");
    assert.ok(packIdx >= 0, '缺少 PACK_AGENT_NOT_COVERED 分流');
    assert.ok(billingIdx >= 0, '缺少 billing_unavailable 分流');
    assert.ok(packIdx > genericIdx && billingIdx > genericIdx, '新分支应排在既有 402 分流之后');
    assert.match(fn.slice(packIdx), /errorCode: 'PACK_AGENT_NOT_COVERED'/);
    assert.match(fn.slice(billingIdx), /errorCode: 'billing_unavailable'/);
    assert.match(fn.slice(billingIdx), /paBillingUnavailable/);
  });

  it('新增文案中英齐备', () => {
    const i18n = read('lib/i18n-messages.js');
    for (const key of ['paPackAgentNotCovered', 'paBillingUnavailable']) {
      const hits = i18n.match(new RegExp(`${key}:`, 'g')) || [];
      assert.ok(hits.length >= 2, `${key} 需中英双语，实际 ${hits.length}`);
    }
  });
});
