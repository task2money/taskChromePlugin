'use strict';

/**
 * 图标打开侧边栏默认「网页优化」；只有任务描述写入非空内容才自动切到创建任务。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

describe('side panel default tab', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.js'), 'utf8');

  it('首屏是网页优化页，并加载页签判定', () => {
    assert.match(html, /id="sp-tab-agent"[^>]*aria-selected="true"/);
    assert.match(html, /id="sp-tab-settings"[^>]*aria-selected="false"/);
    assert.match(html, /id="sp-tab-agent"/);
    assert.match(html, /data-i18n="agentSuggestionsTab"/);
    const agentPaneTag = html.match(/<div id="sp-pane-agent"[^>]*>/);
    assert.ok(agentPaneTag, 'agent pane present');
    assert.doesNotMatch(agentPaneTag[0], /\bhidden\b/);
    assert.match(html, /<div id="sp-pane-settings"[^>]*\bhidden\b/);
    assert.match(html, /<span data-i18n="agentSuggestionsTab">网页优化<\/span>/);
    assert.match(html, /<h3 data-i18n="agentSuggestionsPanelTitle">网页优化建议<\/h3>/);
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
    // 服务端目录加载失败时给用户看的出口：状态行 + 重试按钮（Task 12）。
    // fake-DOM 单测会凭空 getElementById 造出元素，删掉页面里的真实节点也照样绿，这里钉住 HTML。
    assert.match(html, /id="sp-agent-prompt-status"/);
    assert.match(html, /id="sp-agent-prompt-retry"/);
    assert.match(html, /data-i18n="agentSuggestionsGenerate"/);
    assert.match(html, /id="sp-pane-create"[^>]*hidden/);
    assert.match(html, /side-panel-bridge\.js/);
    assert.match(js, /getSidePanelOpenIntent/);
    assert.match(js, /SidePanelBridge\.DEFAULT_SIDE_PANEL_TAB/);
    assert.match(js, /sidePanel\.onOpened/);
  });

  it('面板按当前网页列列表，点生成走后台生成消息', () => {
    const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'agent-suggestions-panel.js'), 'utf8');
    assert.match(panel, /listSitePendingForActiveTab/);
    assert.match(panel, /refreshSitePendingForActiveTab/);
    assert.match(panel, /generateAgentSuggestionsForActiveTab/);
    // 提示词下拉的数据源已改为服务端目录（Task 12）：本机 prompt skills 不再被面板读取。
    assert.match(panel, /loadPageAdvisorPromptOptions/);
    assert.match(panel, /PageAdvisorPromptOptions/);
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
