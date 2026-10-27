'use strict';

/**
 * 侧边栏顶部页签：「网页优化建议」固定在第一栏（最左），其余页签保持相对顺序。
 * 页签顺序直接影响首屏可见与键盘 Tab 顺序，改顺序必须有用例守着。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

describe('side panel tab order', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.html'), 'utf8');

  it('网页优化建议排在第一栏，其余为 创建任务 → 设置 → 本机模型', () => {
    const tablist = html.match(/<div class="sp-tabs"[^>]*>([\s\S]*?)<\/div>/);
    assert.ok(tablist, 'tablist present');

    // 前置空白排除 data-testid="sp-tab-…" 这类同后缀属性。
    const ids = [...tablist[1].matchAll(/(?:^|\s)id="sp-tab-([a-z-]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, ['agent', 'create', 'settings', 'builtin']);

    const agentButton = tablist[1].match(/<button[^>]*id="sp-tab-agent"[\s\S]*?<\/button>/);
    assert.ok(agentButton, 'agent tab button present');
    assert.match(agentButton[0], /data-i18n="agentSuggestionsTab">网页优化建议/);
    assert.match(agentButton[0], /id="sp-agent-count"/);
  });

  it('首屏默认页签仍是设置（第一栏不改变图标打开行为）', () => {
    assert.match(html, /id="sp-tab-settings"[^>]*aria-selected="true"/);
  });
});
