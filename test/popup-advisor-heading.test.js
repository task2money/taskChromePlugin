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

/**
 * 取 popup 运行时实际生效的消息表：基础表之后，i18n-llm-route.js 与
 * i18n-skill-browse-messages.js 按 popup.html 的脚本顺序覆盖同名键。
 * 只读基础表会断言到运行时已被覆盖、不会展示的字面量。
 */
function i18nMessages() {
  const { I18N_SCRIPT_RELS } = require('./helpers/txRuntime.js');
  const merged = { zh: {}, en: {} };
  for (const rel of I18N_SCRIPT_RELS) {
    const mod = require(path.join('..', rel));
    if (!mod || !mod.zh || !mod.en) continue;
    Object.assign(merged.zh, mod.zh);
    Object.assign(merged.en, mod.en);
  }
  return merged;
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

  it('调用方式默认直连并标注免费，平台后端不加标记', () => {
    const llm = llmSection();
    assert.match(llm, /id="popupLlmRouteDirect"[^>]*\bchecked\b/);
    assert.doesNotMatch(llm, /id="popupLlmRouteSaas"[^>]*\bchecked\b/);
    const msg = i18nMessages();
    assert.equal(msg.zh.paLlmRouteDirect, '直连我的 Key（免费）');
    assert.equal(msg.zh.paLlmRouteSaas, '调用平台后端');
    assert.equal(msg.en.paLlmRouteDirect, 'Direct with my key (free)');
    assert.equal(msg.en.paLlmRouteSaas, 'Platform backend');
    assert.doesNotMatch(msg.zh.paLlmSectionHint, /消耗资源/);
    assert.doesNotMatch(msg.en.paLlmSectionHint, /uses resources/);
    assert.match(msg.zh.paSkillSectionHint, /预埋自动创新这一条技能/);
    assert.match(msg.en.paSkillSectionHint, /Only the auto-innovate skill is preloaded/);
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

  it('两个区块各不越界：智能体 ! 区不出现 Alt+X，快捷键区不出现 Alt+Z（含 OPT-20260922-011 Skill 提示）', () => {
    assert.doesNotMatch(advisorSection(), /Alt\+X/);
    assert.doesNotMatch(shortcutsSection(), /Alt\+Z/);
  });
});

/**
 * OPT-20260922-011：Skill 只在「直连智能体」路径追加，而直连同时服务 Alt+Z（整页）
 * 与 Alt+Shift+Z（区域点选）。提示只写任一键都会让用户以为另一条路径不带倾向。
 */
describe('Prompt Skill 提示的快捷键主张（OPT-20260922-011）', () => {
  it('paSkillSectionHint 在 zh/en 同时写明 Alt+Z 与 Alt+Shift+Z', () => {
    for (const locale of ['zh', 'en']) {
      const hint = i18nMessages()[locale].paSkillSectionHint;
      assert.match(hint, /Alt\+Z/, `${locale} 应说明整页直连 Alt+Z`);
      assert.match(hint, /Alt\+Shift\+Z/, `${locale} 应说明区域直连 Alt+Shift+Z`);
    }
  });

  it('popup.html 的 data-i18n 兜底文案与消息表同源主张两键', () => {
    const m = popupHtml().match(/data-i18n="paSkillSectionHint"[^>]*>([^<]*)</);
    assert.ok(m, 'popup.html 缺少 paSkillSectionHint 兜底文案');
    assert.match(m[1], /Alt\+Z/, 'HTML 兜底文案应说明整页直连 Alt+Z');
    assert.match(m[1], /Alt\+Shift\+Z/, 'HTML 兜底文案应说明区域直连 Alt+Shift+Z');
  });

  it('用户指南 Skill 步骤同时写明 Alt+Z 与 Alt+Shift+Z', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/user-guide.js'), 'utf8');
    const step = src.split('\n').find((line) => line.includes('提示词 Skill（倾向）'));
    assert.ok(step, '未找到用户指南 Prompt Skill 步骤');
    assert.match(step, /Alt\+Z/);
    assert.match(step, /Alt\+Shift\+Z/);
  });
});
