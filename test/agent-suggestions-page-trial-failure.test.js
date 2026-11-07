'use strict';

/**
 * 匿名试用失败映射（2026-11-07 细分错误码）：
 * 服务端 502 的 error_code 要落到各自文案，并把 retryable / elapsed_ms /
 * attempts / model / upstream_request_id 透传给侧栏与诊断中心。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadFailureMapper() {
  const context = {
    console,
    tx(key, vars) {
      return vars ? `${key}:${JSON.stringify(vars)}` : key;
    },
    PageAdvisorTrialAPI: {},
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'background', 'sw-page-advisor-page-trial.js'), 'utf8'),
    context,
  );
  return context.pageTrialFailure;
}

const pageTrialFailure = loadFailureMapper();

describe('匿名试用失败映射（细分错误码）', () => {
  it('超时：按 elapsed_ms 落秒数文案，并带 route/retryable/attempts/model', () => {
    const failure = pageTrialFailure({
      errorCode: 'page_trial_timeout',
      elapsedMs: 90123,
      attempts: 1,
      model: 'deepseek-flash',
      retryable: false,
      traceId: 'trace-timeout',
      quota: { enabled: true, remaining: 2, daily_quota: 3 },
    });
    assert.equal(failure.ok, false);
    assert.equal(failure.errorCode, 'page_trial_timeout');
    assert.equal(failure.error, 'paTrialTimeout:{"sec":90}');
    assert.equal(failure.route, 'trial');
    assert.equal(failure.retryable, false);
    assert.equal(failure.elapsedMs, 90123);
    assert.equal(failure.attempts, 1);
    assert.equal(failure.model, 'deepseek-flash');
    assert.equal(failure.traceId, 'trace-timeout');
    assert.deepEqual(failure.quota, { enabled: true, remaining: 2, daily_quota: 3 });
  });

  it('超时但没有 elapsed_ms：用通用超时文案，不留下未替换的 {sec}', () => {
    const failure = pageTrialFailure({ errorCode: 'page_trial_timeout' });
    assert.equal(failure.error, 'paTrialTimeoutGeneric');
  });

  it('上游 5xx / 网络 / 空结果 / 解析失败各有独立文案', () => {
    assert.equal(pageTrialFailure({ errorCode: 'page_trial_upstream_error' }).error, 'paTrialUpstreamError');
    assert.equal(pageTrialFailure({ errorCode: 'page_trial_network_error' }).error, 'paTrialNetworkError');
    assert.equal(pageTrialFailure({ errorCode: 'page_trial_empty_result' }).error, 'paTrialEmptyResult');
    assert.equal(pageTrialFailure({ errorCode: 'page_trial_invalid_result' }).error, 'paTrialInvalidResult');
  });

  it('旧码 page_trial_generate_failed 仍映射到旧文案（服务端未升级时兼容）', () => {
    const failure = pageTrialFailure({ errorCode: 'page_trial_generate_failed' });
    assert.equal(failure.error, 'paTrialGenerateFailed');
  });

  it('未知错误码优先展示服务端 detail；upstream_request_id 原样透传', () => {
    const failure = pageTrialFailure({
      errorCode: 'something_new',
      detail: '上游返回了新的错误',
      upstreamRequestId: 'req-42',
    });
    assert.equal(failure.error, '上游返回了新的错误');
    assert.equal(failure.errorCode, 'something_new');
    assert.equal(failure.upstreamRequestId, 'req-42');
    assert.equal(failure.route, 'trial');
  });
});
