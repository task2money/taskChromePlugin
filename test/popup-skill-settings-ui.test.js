'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const {
  isLlmSettingsExpanded,
  setLlmSettingsExpanded,
  toggleLlmSettingsExpanded,
} = require('../lib/popup-llm-settings-ui.js');

function popupHtml() {
  return fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
}

describe('Popup Skill settings toggle', () => {
  it('T1 标题旁有设置按钮，管理区在 #pageAdvisorSkillFields', () => {
    const html = popupHtml();
    const skill = html.match(/id="pageAdvisorSkillSection"[\s\S]*?<\/section>/)[0];
    assert.match(skill, /id="btnToggleSkillSettings"/);
    assert.match(skill, /aria-controls="pageAdvisorSkillFields"/);
    assert.match(skill, /data-i18n="paSkillSettings"/);
    assert.match(skill, /id="pageAdvisorSkillFields"/);
    assert.match(skill, /id="popupSkillSyncTarget"/);
    const fieldsIdx = skill.indexOf('id="pageAdvisorSkillFields"');
    const statusIdx = skill.indexOf('id="popupSkillStatus"');
    assert.ok(fieldsIdx >= 0 && statusIdx > fieldsIdx);
    const fieldsBlock = skill.slice(fieldsIdx, statusIdx);
    assert.match(fieldsBlock, /id="popupSkillBody"/);
    assert.match(fieldsBlock, /id="btnSkillSave"/);
    assert.match(fieldsBlock, /id="popupSkillEditor"/);
    assert.doesNotMatch(skill, /id="btnSkillHistoryLoad"/);
    assert.doesNotMatch(skill, /id="btnSkillDelete"/);
    assert.match(skill, /id="popupSkillDeleteConfirm"/);
    assert.doesNotMatch(skill, /id="btnSkillClearActive"/);
    assert.match(skill, /data-i18n="paSkillListLabel"[\s\S]*id="btnSkillNew"/);
    assert.match(skill, /data-i18n="paSkillTendency">类别/);
    assert.match(skill, /id="popupSkillEditor"[^>]*style="display:none"/);
    assert.doesNotMatch(fieldsBlock, /id="btnToggleSkillSettings"/);
    const heading = skill.slice(0, fieldsIdx);
    assert.match(heading, /id="btnToggleSkillSettings"/);
  });

  it('提示词集市在「提示词 Skill」标题内、设置按钮之前', () => {
    const html = popupHtml();
    const skill = html.match(/id="pageAdvisorSkillSection"[\s\S]*?<\/section>/)[0];
    const heading = skill.slice(0, skill.indexOf('id="pageAdvisorSkillFields"'));
    const h3 = heading.match(/<h3>[\s\S]*?<\/h3>/);
    assert.ok(h3, '标题行应有 h3');
    assert.match(h3[0], /data-i18n="paSkillSectionTitle"/);
    assert.match(h3[0], /id="lnkPromptMarket"/, '集市链接应在标题 h3 内，紧挨「提示词 Skill」');
    const titleAt = h3[0].indexOf('data-i18n="paSkillSectionTitle"');
    const marketAt = h3[0].indexOf('id="lnkPromptMarket"');
    assert.ok(marketAt > titleAt, '集市链接应排在标题文案之后');
    assert.ok(
      heading.indexOf('id="btnToggleSkillSettings"') > heading.indexOf('</h3>'),
      '设置按钮仍在标题之后',
    );
    const css = fs.readFileSync(path.join(ROOT, 'popup/popup.css'), 'utf8');
    assert.match(
      css,
      /#pageAdvisorSkillSection \.llm-section-heading h3\s*\{[^}]*flex:\s*0 1 auto/,
      '标题不得再 flex 撑满，否则集市链接会被挤离文案',
    );
  });

  it('T2 管理区默认折叠且 aria-expanded=false', () => {
    const html = popupHtml();
    const skill = html.match(/id="pageAdvisorSkillSection"[\s\S]*?<\/section>/)[0];
    assert.match(skill, /id="pageAdvisorSkillFields"[^>]*style="display:none"/);
    assert.match(skill, /id="btnToggleSkillSettings"[^>]*aria-expanded="false"/);
  });

  it('T3 复用 LLM 折叠助手同步 display 与 aria-expanded', () => {
    const fields = { style: { display: 'none' }, hidden: true };
    const btn = {
      attrs: { 'aria-expanded': 'false' },
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k]; },
    };
    assert.equal(isLlmSettingsExpanded(fields), false);
    setLlmSettingsExpanded(fields, btn, true);
    assert.equal(fields.style.display, 'block');
    assert.equal(btn.getAttribute('aria-expanded'), 'true');
    assert.equal(toggleLlmSettingsExpanded(fields, btn), false);
  });
});
