'use strict';

/**
 * 弹窗标题行三处对比度：快捷键白底、使用说明暗金、设置按钮米色底。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function ruleBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  assert.ok(m, `缺少规则 ${selector}`);
  return m[1];
}

describe('Popup heading chrome colors', () => {
  it('Alt+Shift+Z 芯片为白底深字', () => {
    const block = ruleBlock(read('popup/popup.css'), '.llm-shortcut');
    assert.match(block, /background:\s*var\(--taskplugin-card\)/);
    assert.match(block, /color:\s*var\(--taskplugin-foreground\)/);
  });

  it('使用说明按钮为暗金底深字，关闭按钮不跟色', () => {
    const css = read('popup/popup-guide.css');
    const block = ruleBlock(css, '#popup-user-guide .tcp-guide-root-summary');
    assert.match(block, /background:\s*var\(--taskplugin-accent\)/);
    assert.match(block, /color:\s*var\(--taskplugin-foreground\)/);
    const close = ruleBlock(css, '#popup-user-guide .tcp-guide-close');
    assert.doesNotMatch(close, /var\(--taskplugin-accent\)/);
  });

  it('提示词标题行设置按钮用米色底和米色线框；LLM 设置在下拉旁用普通按钮', () => {
    const css = read('popup/popup.css');
    const block = ruleBlock(css, '#pageAdvisorSkillSection #btnToggleSkillSettings');
    assert.match(block, /background:\s*var\(--taskplugin-muted\)/);
    assert.match(block, /border-color:\s*var\(--taskplugin-border\)/);
    assert.doesNotMatch(
      css,
      /#pageAdvisorLlmSection #btnToggleLlmSettings[^{]*\{[^}]*background:\s*transparent/,
      'LLM 设置已离开标题行，不再用透明标题样式',
    );
  });

  it('侧边栏浅色底上技能设置文字保持深色', () => {
    const css = read('popup/popup-sidepanel.css');
    const block = ruleBlock(
      css,
      'html[data-taskplugin-host="sidepanel"] #pageAdvisorSkillSection #btnToggleSkillSettings',
    );
    assert.match(block, /background:\s*var\(--taskplugin-muted\)/);
    assert.match(block, /border-color:\s*var\(--taskplugin-border\)/);
    assert.match(block, /color:\s*var\(--taskplugin-foreground\)/);
    assert.doesNotMatch(
      css,
      /#pageAdvisorLlmSection #btnToggleLlmSettings/,
      '侧栏不再单独覆盖 LLM 设置标题透明样式',
    );
  });
});
