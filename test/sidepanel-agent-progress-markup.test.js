'use strict';

/**
 * 生成进度条的无障碍标记：
 * - 阶段文案用 aria-live="polite"，只在阶段切换时播报；
 * - 百分比/耗时会每 500ms 刷新，对读屏器隐藏，避免刷屏；
 * - `<progress>` 自带 role=progressbar，数值由脚本同步 aria-valuenow。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel', 'sidepanel.html'), 'utf8');

describe('侧栏生成进度条标记', () => {
  it('阶段文案加 aria-live，百分比与耗时对读屏器隐藏', () => {
    assert.match(
      html,
      /id="sp-agent-progress-stage"[^>]*aria-live="polite"/,
      '阶段切换要播报，但不能每 500ms 刷屏',
    );
    assert.match(html, /id="sp-agent-progress-pct"[^>]*aria-hidden="true"/);
    assert.match(html, /id="sp-agent-progress-elapsed"[^>]*aria-hidden="true"/);
  });

  it('进度条本身是原生 progress，最大值 100；文案容器有分组标签', () => {
    assert.match(html, /<progress id="sp-agent-progress-bar"[^>]*max="100"/);
    assert.match(
      html,
      /id="sp-agent-progress"[^>]*role="group"[^>]*data-i18n-aria-label="agentSuggestionsProgressAria"/,
    );
    assert.match(html, /id="sp-agent-progress"[^>]*hidden/);
  });

  it('侧栏加载共享进度模型（阶段起点/上限与后台同源）', () => {
    assert.match(html, /<script src="\.\.\/lib\/agent-suggestions-progress\.js"><\/script>/);
  });

  it('侧栏加载耗时自学习模块（剩余时间按历史实际耗时估算）', () => {
    assert.match(html, /<script src="\.\.\/lib\/agent-suggestions-eta\.js"><\/script>/);
  });
});
