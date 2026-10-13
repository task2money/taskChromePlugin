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
    assert.match(html, /id="sp-agent-count"/);
    assert.match(html, /id="sp-agent-count"[^>]*hidden/);
    assert.match(html, /<span data-i18n="agentSuggestionsTab">/);
    // 网址输入框、查询按钮、「查询时包含网址参数」都已去掉（ADR-0167）。
    assert.doesNotMatch(html, /id="sp-agent-url"/);
    assert.doesNotMatch(html, /id="sp-agent-query"/);
    assert.doesNotMatch(html, /id="sp-agent-include-query"/);
    assert.doesNotMatch(html, /agentSuggestionsIncludeQuery/);
    const promptAt = html.indexOf('id="sp-agent-prompt"');
    const generateAt = html.indexOf('id="sp-agent-generate"');
    assert.ok(promptAt >= 0, 'prompt dropdown present');
    assert.ok(generateAt > promptAt, 'generate button sits after the prompt dropdown');
    assert.match(html, /id="sp-agent-prompt"[^>]*data-i18n-aria-label="agentSuggestionsPromptLabel"/);
    assert.match(html, /data-i18n="agentSuggestionsGenerate"/);
    assert.match(html, /id="sp-pane-create"[^>]*hidden/);
    assert.match(html, /side-panel-bridge\.js/);
    assert.match(js, /getSidePanelOpenIntent/);
    assert.match(js, /sidePanel\.onOpened/);
  });

  it('面板按当前网页列列表，点生成走后台生成消息', () => {
    const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'agent-suggestions-panel.js'), 'utf8');
    assert.match(panel, /listSitePendingForActiveTab/);
    assert.match(panel, /refreshSitePendingForActiveTab/);
    assert.match(panel, /generateAgentSuggestionsForActiveTab/);
    assert.match(panel, /PageAdvisorPromptSkills/);
    assert.match(panel, /selectAgentSuggestionPost/);
    assert.doesNotMatch(panel, /buildSitePendingPostBodyHtml/);
    assert.doesNotMatch(panel, /agentSuggestionsIncludeQuery/);
    assert.doesNotMatch(panel, /resolveAgentSuggestionLookupUrl/);
    assert.doesNotMatch(panel, /isPinnedToTypedUrl/);
    assert.match(js, /agentSuggestionsListed/);
    assert.match(js, /applyAgentSuggestionBadge/);
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
