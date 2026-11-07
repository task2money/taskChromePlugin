'use strict';

/**
 * 「给当前网页生成建议」本地诊断中心：环形 10 条、URL 去 query/hash、
 * 不落页面正文 / token、单条字段封顶，复制文本包含 traceId / 错误码 / 耗时。
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const Diag = require('../lib/agent-suggestions-diagnostics.js');

function makeLocalArea() {
  const data = new Map();
  return {
    data,
    async get(key) {
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(patch) {
      Object.keys(patch || {}).forEach((key) => data.set(key, patch[key]));
    },
    async remove(key) {
      data.delete(key);
    },
  };
}

let area = null;

beforeEach(() => {
  area = makeLocalArea();
  global.chrome = { storage: { local: area } };
});

afterEach(() => {
  delete global.chrome;
});

describe('agent-suggestions-diagnostics 环形缓冲', () => {
  it('append → list：新记录在前，只保留最近 10 条', async () => {
    for (let i = 0; i < 12; i += 1) {
      await Diag.append({
        runId: `run-${i}`,
        at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
        tabId: 7,
        result: 'failed',
        errorCode: 'page_trial_timeout',
      });
    }
    const rows = await Diag.list();
    assert.equal(rows.length, Diag.MAX);
    assert.equal(rows[0].runId, 'run-11');
    assert.equal(rows[rows.length - 1].runId, 'run-2', '超出上限时丢最旧');
  });

  it('同一个 runId 再写一次是覆盖而不是新增', async () => {
    await Diag.append({ runId: 'dup', result: 'failed', errorCode: 'a' });
    await Diag.append({ runId: 'dup', result: 'success', postId: 'p1' });
    const rows = await Diag.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].result, 'success');
    assert.equal(rows[0].postId, 'p1');
  });

  it('latestForTab 优先当前 tab，找不到时退回全局最近一条', async () => {
    await Diag.append({ runId: 'tab-7', tabId: 7, result: 'failed' });
    await Diag.append({ runId: 'tab-8', tabId: 8, result: 'success' });
    assert.equal((await Diag.latestForTab(7)).runId, 'tab-7');
    assert.equal((await Diag.latestForTab(999)).runId, 'tab-8');
  });

  it('clear 清空缓冲', async () => {
    await Diag.append({ runId: 'run-clear', result: 'failed' });
    assert.equal(await Diag.clear(), true);
    assert.deepEqual(await Diag.list(), []);
  });

  it('存储不可用时静默失败（诊断不影响生成）', async () => {
    delete global.chrome;
    assert.equal(await Diag.append({ runId: 'no-store', result: 'failed' }), false);
    assert.deepEqual(await Diag.list(), []);
  });
});

describe('agent-suggestions-diagnostics 隐私与体积边界', () => {
  it('pageUrl 去掉 query/hash，accessCode 不进入记录', () => {
    const entry = Diag.normalizeEntry({
      runId: 'r-url',
      pageUrl: 'https://www.daydaymoney.com/friend-links?accessCode=SECRET123#frag',
    });
    assert.equal(entry.pageUrl, 'https://www.daydaymoney.com/friend-links');
    assert.ok(!JSON.stringify(entry).includes('SECRET123'));
  });

  it('只保留白名单字段：页面正文、token、accessCode 一律丢弃', () => {
    const entry = Diag.normalizeEntry({
      runId: 'r-private',
      pageText: '这是页面正文-不可落盘',
      domOutline: [{ text: '正文' }],
      token: 'tk-secret',
      accessCode: 'ac-secret',
      errorText: '服务端错误',
    });
    const json = JSON.stringify(entry);
    assert.ok(!json.includes('页面正文'));
    assert.ok(!json.includes('tk-secret'));
    assert.ok(!json.includes('ac-secret'));
    assert.equal(entry.errorText, '服务端错误');
  });

  it('超长字段被截断：errorText 500、pageUrl 2048', () => {
    const entry = Diag.normalizeEntry({
      runId: 'r-long',
      errorText: 'x'.repeat(5000),
      pageUrl: `https://x.test/${'a'.repeat(4000)}`,
    });
    assert.equal(entry.errorText.length, 500);
    assert.ok(entry.pageUrl.length <= Diag.URL_MAX);
  });

  it('时间线只保留最后 12 个阶段节点', () => {
    const timeline = Array.from({ length: 30 }, (_, i) => ({ stage: `s${i}`, t: i }));
    const entry = Diag.normalizeEntry({ runId: 'r-timeline', stageTimeline: timeline });
    assert.equal(entry.stageTimeline.length, 12);
    assert.equal(entry.stageTimeline[0].stage, 's18');
    assert.equal(entry.stageTimeline[11].stage, 's29');
  });
});

describe('agent-suggestions-diagnostics 复制文本', () => {
  const current = {
    at: '2026-11-07T08:47:44.797Z',
    tabId: 7,
    pageUrl: 'https://www.daydaymoney.com/friend-links?accessCode=S',
    route: 'trial',
    runId: 'run-copy',
    result: 'failed',
    errorCode: 'page_trial_timeout',
    errorText: '模型生成超时（已等待 90 秒），本次未占用试用次数。',
    traceId: '883b620a-6085-4bfc-8e65-eb721d6870b4',
    retryable: true,
    elapsedMs: 90123,
    attempts: 1,
    model: 'deepseek-flash',
    promptSkillId: 'sys_tendency_jev_seo',
    trialId: '906827250199011328',
    quota: { enabled: true, remaining: 2, daily_quota: 3 },
    stageTimeline: [{ stage: 'capture', t: 0 }, { stage: 'failed', t: 90123 }],
    pluginVersion: '1.9.14',
  };

  it('包含错误码 / traceId / 耗时 / 最近尝试，且不含 query 参数', () => {
    const recent = [
      current,
      {
        at: '2026-11-07T07:59:40.000Z',
        route: 'trial',
        result: 'failed',
        errorCode: 'page_trial_upstream_error',
        elapsedMs: 15300,
        traceId: 'e1b58b35-0a2f-46ec-a7e9-bb637dab7a81',
      },
    ];
    const text = Diag.buildCopyText(Diag.normalizeEntry(current), recent.map((r) => Diag.normalizeEntry(r)));
    assert.match(text, /page_trial_timeout/);
    assert.match(text, /traceId: 883b620a-6085-4bfc-8e65-eb721d6870b4/);
    assert.match(text, /90123 ms/);
    assert.match(text, /匿名试用/);
    assert.match(text, /最近尝试/);
    assert.match(text, /page_trial_upstream_error/);
    assert.match(text, /15\.3s/);
    assert.ok(!text.includes('accessCode=S'), 'URL 去 query，敏感参数不进复制文本');
    assert.equal(text.split('1)').length - 1, 1, '当前记录不在「最近尝试」里重复');
  });

  it('当前记录为空时仍能输出最近尝试', () => {
    const text = Diag.buildCopyText(null, [{
      at: '2026-11-07T09:00:00.000Z',
      route: 'saas',
      result: 'success',
      postId: 'p-9',
      traceId: 'trace-12345678',
      elapsedMs: 19000,
    }]);
    assert.match(text, /登录态/);
    assert.match(text, /成功/);
    assert.match(text, /postId=p-9/);
    assert.match(text, /traceId=trace-12…/);
  });
});
