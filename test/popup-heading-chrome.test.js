'use strict';

/**
 * 弹窗标题行三处对比度：快捷键白底、使用说明青色、设置按钮透明底。
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
    assert.match(block, /background:\s*#fff\b/);
    assert.match(block, /color:\s*#1e1e2e\b/);
  });

  it('使用说明按钮为青色底深字，关闭按钮不跟色', () => {
    const css = read('popup/popup-guide.css');
    const block = ruleBlock(css, '#popup-user-guide .tcp-guide-root-summary');
    assert.match(block, /background:\s*#00bcd4\b/);
    assert.match(block, /color:\s*#1e1e2e\b/);
    const close = ruleBlock(css, '#popup-user-guide .tcp-guide-close');
    assert.doesNotMatch(close, /#00bcd4/);
  });

  it('自动创新与提示词的设置按钮背景透明', () => {
    const css = read('popup/popup.css');
    const block = ruleBlock(
      css,
      '#pageAdvisorLlmSection #btnToggleLlmSettings,\n'
      + '#pageAdvisorSkillSection #btnToggleSkillSettings',
    );
    assert.match(block, /background:\s*transparent\b/);
    assert.match(block, /border-color:\s*transparent\b/);
  });

  it('侧边栏浅色底上设置文字保持深色', () => {
    const css = read('popup/popup-sidepanel.css');
    const block = ruleBlock(
      css,
      'html[data-taskplugin-host="sidepanel"] #pageAdvisorLlmSection #btnToggleLlmSettings,\n'
      + 'html[data-taskplugin-host="sidepanel"] #pageAdvisorSkillSection #btnToggleSkillSettings',
    );
    assert.match(block, /background:\s*transparent\b/);
    assert.match(block, /color:\s*#1e1e2e\b/);
  });
});
