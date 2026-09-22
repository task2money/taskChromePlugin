'use strict';

/**
 * Popup Auto-innovate 标题直接展示 Alt+Shift+Z；不再有独立默认工作空间区。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function popupHtml() {
  return fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
}

function i18nMessages() {
  return require('../lib/i18n-messages.js');
}

function llmSection() {
  const html = popupHtml();
  const m = html.match(/id="pageAdvisorLlmSection"[\s\S]*?<\/section>/);
  assert.ok(m, '缺少 pageAdvisorLlmSection');
  return m[0];
}

describe('Popup advisor heading', () => {
  it('不再渲染独立默认工作空间 / 项目区块', () => {
    const html = popupHtml();
    assert.doesNotMatch(html, /id="pageAdvisorDefaultsSection"/);
    assert.doesNotMatch(html, /id="popupDefaultWorkspace"/);
    assert.doesNotMatch(html, /id="popupDefaultProjects"/);
    assert.doesNotMatch(html, /popup-defaults\.js/);
  });

  it('Auto-innovate 标题行直接显示 Alt+Shift+Z', () => {
    const llm = llmSection();
    const heading = llm.slice(0, llm.indexOf('id="pageAdvisorLlmFields"'));
    assert.match(heading, /data-i18n="paLlmSectionTitle"/);
    assert.match(heading, /<kbd[^>]*data-i18n="altZDefaults"[^>]*>Alt\+Shift\+Z<\/kbd>/);
    assert.doesNotMatch(heading, /default context|默认上下文/);
    const msg = i18nMessages();
    assert.equal(msg.zh.altZDefaults, 'Alt+Shift+Z');
    assert.equal(msg.en.altZDefaults, 'Alt+Shift+Z');
  });

  it('exposes plugin-direct LLM config section', () => {
    const html = popupHtml();
    assert.match(html, /id="pageAdvisorLlmSection"/);
    assert.match(html, /data-i18n="paLlmApiKey"/);
    assert.match(html, /id="pageAdvisorSkillSection"/);
    assert.match(html, /data-i18n="paSkillBody"/);
    assert.match(html, /id="btnSaveLlmConfig"/);
  });

  it('T5 Auto-innovate agent 文案快捷键为 Alt+Shift+Z', () => {
    const msg = i18nMessages();
    for (const locale of ['zh', 'en']) {
      const hint = msg[locale].paLlmSectionHint;
      assert.match(hint, /Alt\+Shift\+Z/, `${locale} paLlmSectionHint 应写 Alt+Shift+Z`);
      assert.doesNotMatch(
        hint,
        /(?<!Shift\+)Alt\+Z/,
        `${locale} paLlmSectionHint 不得把直连快捷键写成单独的 Alt+Z`,
      );
    }
    const llm = llmSection();
    const h3 = llm.match(/<h3>[\s\S]*?<\/h3>/)[0];
    assert.match(h3, /Alt\+Shift\+Z/);
    assert.doesNotMatch(h3, /(?<!Shift\+)Alt\+Z/);
    assert.match(llm, /id="btnToggleLlmSettings"/);
  });

  it('快捷键说明收在 ! 的 details/summary 内且默认不展开', () => {
    const section = llmSection();
    assert.match(section, /<summary[^>]*>!<\/summary>/);
    assert.match(section, /<details[\s\S]*data-i18n="altZHint"/);
    assert.doesNotMatch(section, /<details\s[^>]*\bopen\b/);
    const hintOutside = section.replace(/<details[\s\S]*?<\/details>/, '');
    assert.doesNotMatch(hintOutside, /data-i18n="altZHint"/);
    const heading = section.slice(0, section.indexOf('<details'));
    assert.doesNotMatch(heading, /data-i18n="altZHint"/);
  });
});

/**
 * OPT-20260921-029：快捷键说明有「!」details 与底部「快捷键」两处入口。
 */
describe('Popup 快捷键双入口不矛盾（OPT-20260921-029）', () => {
  const uiMessages = require('../lib/i18n-ui-messages.js');

  function advisorSection() {
    return llmSection();
  }

  function shortcutsSection() {
    return popupHtml().match(/<section id="shortcutsSection"[\s\S]*?<\/section>/)[0];
  }

  function kbdText(id) {
    const m = popupHtml().match(new RegExp(`<kbd id="${id}"[^>]*>([^<]*)</kbd>`));
    return m ? m[1].trim() : '';
  }

  it('altZHint 只主张 Alt+Z / Alt+Shift+Z，不主张拾取键 Alt+X', () => {
    for (const locale of ['zh', 'en']) {
      const hint = i18nMessages()[locale].altZHint;
      assert.match(hint, /Alt\+Z/, `${locale} altZHint 应说明 Alt+Z`);
      assert.match(hint, /Alt\+Shift\+Z/, `${locale} altZHint 应说明 Alt+Shift+Z`);
      assert.doesNotMatch(hint, /Alt\+X(?!\w)/, `${locale} altZHint 不得主张 Alt+X`);
      assert.doesNotMatch(hint, /此处的默认工作空间/, `${locale} 不得再指向已删除的 Popup 默认空间选择器`);
    }
  });

  it('拾取区文案只主张 Alt+X，不重述 Alt+Z / Alt+Shift+Z', () => {
    for (const locale of ['zh', 'en']) {
      const note = uiMessages[locale].popupPickShortcutNote;
      assert.match(note, /Alt\+X/, `${locale} popupPickShortcutNote 应给出默认 Alt+X`);
      assert.doesNotMatch(note, /Alt\+Z|Alt\+Shift\+Z/, `${locale} 拾取区不得重述采集键位`);
    }
  });

  it('默认拾取键三处 kbd 一致，且与 popupPickShortcutNote 声明的默认键一致', () => {
    const keys = ['pickShortcutKey', 'pickShortcutCustomKey', 'pickShortcutHintKey']
      .map(kbdText);
    assert.equal(new Set(keys).size, 1, `三处默认拾取键不一致: ${keys.join(' / ')}`);
    const note = uiMessages.zh.popupPickShortcutNote;
    assert.ok(
      note.includes(keys[0]),
      `popupPickShortcutNote 未声明默认键 ${keys[0]}`,
    );
  });

  it('两个区块各不越界：智能体 ! 区不出现 Alt+X，快捷键区不出现 Alt+Z', () => {
    assert.doesNotMatch(advisorSection(), /Alt\+X/);
    assert.doesNotMatch(shortcutsSection(), /Alt\+Z/);
  });
});
