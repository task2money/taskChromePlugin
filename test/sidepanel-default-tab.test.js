'use strict';

/**
 * 图标打开侧边栏默认设置；只有任务描述写入非空内容才自动切到创建任务。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

describe('side panel default tab', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.js'), 'utf8');

  it('首屏是设置页，并加载页签判定', () => {
    assert.match(html, /id="sp-tab-settings"[^>]*aria-selected="true"/);
    assert.match(html, /id="sp-tab-agent"/);
    assert.match(html, /data-i18n="agentSuggestionsTab"/);
    assert.match(html, /id="sp-pane-agent"[^>]*hidden/);
    assert.match(html, /智能体建议/);
    assert.match(html, /id="sp-agent-include-query"/);
    assert.doesNotMatch(html, /id="sp-agent-include-query"[^>]*checked/);
    assert.match(html, /data-i18n="agentSuggestionsIncludeQuery"/);
    assert.match(html, /id="sp-pane-create"[^>]*hidden/);
    assert.match(html, /side-panel-bridge\.js/);
    assert.match(js, /getSidePanelOpenIntent/);
    assert.match(js, /sidePanel\.onOpened/);
  });

  it('查询开关写到本机并让页面浮层重拉', () => {
    const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'agent-suggestions-panel.js'), 'utf8');
    assert.match(panel, /agentSuggestionsIncludeQuery/);
    assert.match(panel, /refreshSitePendingForActiveTab/);
    assert.match(panel, /Anti-Replay-OK: local lookup preference/);
  });

  it('任务描述有内容才自动显示创建任务', () => {
    assert.match(js, /if \(description\.trim\(\)\) showTab\('create'\)/);
    assert.doesNotMatch(js, /showTab\(stored && stored\.sidePanelTab\)/);
  });

  it('启动时 hydrate i18n 再 applyDom，避免本机模型状态显示键名', () => {
    assert.match(js, /hydrateFromStorage/);
    assert.match(js, /applyDom\(document\)/);
  });
});
