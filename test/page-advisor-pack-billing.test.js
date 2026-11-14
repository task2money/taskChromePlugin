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

  it('202 回带的 billing_mode 投影透传到受理结果（OPT-20261109-001）', () => {
    const sw = read('background/sw-page-advisor-generate.js');
    const fnAt = sw.indexOf('async function generateViaPlatform');
    assert.ok(fnAt >= 0, '缺少 generateViaPlatform');
    assert.ok(sw.indexOf('billingMode: String(created?.billing_mode', fnAt) > fnAt,
      '受理成功结果需带 billing_mode 投影');
    assert.ok(sw.indexOf('billingFeatureCode: String(created?.billing_feature_code', fnAt) > fnAt,
      '受理成功结果需带 billing_feature_code 投影');
  });

  it('诊断条目记录计费来源，复制文本可区分功能包/单项（OPT-20261109-001）', () => {
    const agent = read('background/sw-agent-suggestions.js');
    const hits = agent.match(/billingMode: result\.billingMode/g) || [];
    assert.ok(hits.length >= 3, `受理成功/落贴失败/生成失败诊断都要带计费模式，实际 ${hits.length}`);

    const Diag = require('../lib/agent-suggestions-diagnostics.js');
    const virtual = Diag.buildCopyText(Diag.normalizeEntry({
      route: 'saas',
      result: 'post_failed',
      billingMode: 'virtual',
      billingFeatureCode: 'auto_optimize',
    }), []);
    assert.match(virtual, /计费: 功能包（auto_optimize）/);

    const raw = Diag.buildCopyText(Diag.normalizeEntry({ route: 'saas', result: 'success', billingMode: 'raw' }), []);
    assert.match(raw, /计费: 单项/);

    // 旧后端不回带投影：不得凭空显示计费行（避免误导排查）。
    const none = Diag.buildCopyText(Diag.normalizeEntry({ route: 'saas', result: 'failed' }), []);
    assert.ok(!none.includes('计费'), '无计费投影时不显示计费行');
  });

  it('新增文案中英齐备', () => {
    // 计费诊断文案在 site-pending-tabs 词典，错误文案在 i18n-messages；
    // 两个文件合起来每个 key 都必须中英各一份。
    const i18n = read('lib/i18n-messages.js') + read('lib/i18n-site-pending-tabs.js');
    for (const key of ['paPackAgentNotCovered', 'paBillingUnavailable',
      'agentSuggestionsDiagBilling', 'agentSuggestionsDiagBillingVirtual', 'agentSuggestionsDiagBillingRaw']) {
      const hits = i18n.match(new RegExp(`${key}:`, 'g')) || [];
      assert.ok(hits.length >= 2, `${key} 需中英双语，实际 ${hits.length}`);
    }
  });
});
