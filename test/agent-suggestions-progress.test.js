'use strict';

/**
 * 侧栏「给当前网页生成建议」的进度模型：
 * 阶段起点/上限、心跳只进不退、poll 状态 → 百分比，以及终态封顶。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Progress = require('../lib/agent-suggestions-progress.js');

describe('agent-suggestions-progress 阶段模型', () => {
  it('阶段起点按 采集→提交→排队→生成→落贴→完成 递增', () => {
    const starts = ['capture', 'submit', 'queued', 'generating', 'posting', 'done']
      .map((stage) => Progress.stagePercent(stage));
    assert.deepEqual(starts, [8, 16, 25, 35, 95, 100]);
    for (let i = 1; i < starts.length; i += 1) {
      assert.ok(starts[i] > starts[i - 1], `${starts[i]} 应大于 ${starts[i - 1]}`);
    }
  });

  it('未知阶段归到 idle，不污染进度', () => {
    assert.equal(Progress.normalizeStage('bogus'), 'idle');
    assert.equal(Progress.normalizeStage(''), 'idle');
    assert.equal(Progress.stagePercent('bogus'), 0);
    assert.equal(Progress.isTerminal('bogus'), false);
  });

  it('心跳在阶段上限内每次 +1，终态不倒退', () => {
    assert.equal(Progress.tickPercent(8, 'capture'), 9);
    assert.equal(Progress.tickPercent(12, 'capture'), 12, '到采集上限就停');
    assert.equal(Progress.tickPercent(35, 'generating'), 36);
    assert.equal(Progress.tickPercent(90, 'generating'), 90, '生成阶段封顶 90，等终态');
    assert.equal(Progress.tickPercent(95, 'done'), 100, '完成直接到 100');
    assert.equal(Progress.tickPercent(70, 'failed'), 70, '失败不让进度倒退');
  });

  it('事件百分比缺失时用阶段起点，并夹在 0–100', () => {
    assert.equal(Progress.percentForEvent({ stage: 'generating' }), 35);
    assert.equal(Progress.percentForEvent({ stage: 'generating', percent: 62.4 }), 62);
    assert.equal(Progress.percentForEvent({ stage: 'generating', percent: 140 }), 100);
    assert.equal(Progress.percentForEvent({ stage: 'generating', percent: -3 }), 0);
    assert.equal(Progress.clampPercent('nope'), 0);
  });

  it('job 状态映射：排队 / 生成 / 落贴 / 失败', () => {
    assert.equal(Progress.stageForJobStatus('queued'), 'queued');
    assert.equal(Progress.stageForJobStatus('running'), 'generating');
    assert.equal(Progress.stageForJobStatus('succeeded'), 'posting');
    assert.equal(Progress.stageForJobStatus('failed'), 'failed');
    assert.equal(Progress.stageForJobStatus('expired'), 'failed');
    assert.equal(Progress.stageForJobStatus(''), 'generating');
  });

  it('poll 百分比按耗时推进：排队 25→35，生成 35→90，终态 95/100', () => {
    assert.equal(Progress.percentForPoll({ status: 'queued', elapsedMs: 0 }), 25);
    assert.equal(Progress.percentForPoll({ status: 'queued', elapsedMs: 15000 }), 30);
    assert.equal(Progress.percentForPoll({ status: 'queued', elapsedMs: 30000 }), 35);
    assert.equal(Progress.percentForPoll({ status: 'running', elapsedMs: 0 }), 35);
    assert.equal(Progress.percentForPoll({ status: 'running', elapsedMs: 15000 }), 63);
    assert.equal(Progress.percentForPoll({ status: 'running', elapsedMs: 30000 }), 90);
    assert.equal(Progress.percentForPoll({ status: 'running', elapsedMs: 120000 }), 90, '超时也不虚报完成');
    assert.equal(Progress.percentForPoll({ status: 'succeeded' }), 95);
    assert.equal(Progress.percentForPoll({ status: 'failed' }), 100);
    assert.equal(Progress.percentForPoll({ status: 'expired' }), 100);
  });

  it('expectedMs 可调：慢任务按自定义预估推进，仍封顶 90', () => {
    assert.equal(Progress.percentForPoll({ status: 'running', elapsedMs: 60000, expectedMs: 60000 }), 90);
    assert.equal(Progress.percentForPoll({ status: 'running', elapsedMs: 30000, expectedMs: 60000 }), 63);
    assert.equal(Progress.percentForPoll({ status: 'running', elapsedMs: 60000, expectedMs: 0 }), 90);
  });
});
