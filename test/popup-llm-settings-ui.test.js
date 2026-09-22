'use strict';

/**
 * Popup Auto-innovate：设置按钮展开/收起 API Key 区。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const {
  isLlmSettingsExpanded,
  setLlmSettingsExpanded,
  toggleLlmSettingsExpanded,
  collapseLlmSettingsAfterSave,
} = require('../lib/popup-llm-settings-ui.js');

function popupHtml() {
  return fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
}

function fakeEls(display, expanded) {
  const fields = { style: { display }, hidden: display === 'none' };
  const btn = {
    attrs: { 'aria-expanded': expanded ? 'true' : 'false' },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
  };
  return { fields, btn };
}

describe('Popup LLM settings toggle (T1–T4)', () => {
  it('T1 标题旁有设置按钮，字段包在 #pageAdvisorLlmFields', () => {
    const html = popupHtml();
    const llm = html.match(/id="pageAdvisorLlmSection"[\s\S]*?<\/section>/)[0];
    assert.match(llm, /id="btnToggleLlmSettings"/);
    assert.match(llm, /aria-controls="pageAdvisorLlmFields"/);
    assert.match(llm, /data-i18n="paLlmSettings"/);
    assert.match(llm, /id="pageAdvisorLlmFields"/);
    const fieldsIdx = llm.indexOf('id="pageAdvisorLlmFields"');
    const statusIdx = llm.indexOf('id="popupLlmStatus"');
    assert.ok(fieldsIdx >= 0 && statusIdx > fieldsIdx, '字段区应在状态行之前');
    const fieldsBlock = llm.slice(fieldsIdx, statusIdx);
    assert.match(fieldsBlock, /id="popupLlmApiKey"/);
    assert.match(fieldsBlock, /id="btnSaveLlmConfig"/);
    assert.doesNotMatch(fieldsBlock, /id="btnToggleLlmSettings"/);
    const heading = llm.slice(0, fieldsIdx);
    assert.match(heading, /id="btnToggleLlmSettings"/);
  });

  it('T2 字段区默认折叠且 aria-expanded=false', () => {
    const html = popupHtml();
    const llm = html.match(/id="pageAdvisorLlmSection"[\s\S]*?<\/section>/)[0];
    assert.match(llm, /id="pageAdvisorLlmFields"[^>]*style="display:none"/);
    assert.match(llm, /id="btnToggleLlmSettings"[^>]*aria-expanded="false"/);
  });

  it('T3 set/toggle 同步 display 与 aria-expanded', () => {
    const { fields, btn } = fakeEls('none', false);
    assert.equal(isLlmSettingsExpanded(fields), false);
    setLlmSettingsExpanded(fields, btn, true);
    assert.equal(fields.style.display, 'block');
    assert.equal(btn.getAttribute('aria-expanded'), 'true');
    const next = toggleLlmSettingsExpanded(fields, btn);
    assert.equal(next, false);
    assert.equal(fields.style.display, 'none');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
  });

  it('T4 保存成功才收起；失败保持展开', () => {
    const ok = fakeEls('block', true);
    collapseLlmSettingsAfterSave(true, ok.fields, ok.btn);
    assert.equal(ok.fields.style.display, 'none');
    assert.equal(ok.btn.getAttribute('aria-expanded'), 'false');

    const fail = fakeEls('block', true);
    collapseLlmSettingsAfterSave(false, fail.fields, fail.btn);
    assert.equal(fail.fields.style.display, 'block');
    assert.equal(fail.btn.getAttribute('aria-expanded'), 'true');
  });

  it('popup-llm-config 保存成功路径调用 collapseLlmSettingsAfterSave', () => {
    const src = fs.readFileSync(path.join(ROOT, 'popup/popup-llm-config.js'), 'utf8');
    assert.match(src, /collapseLlmSettingsAfterSave\(\s*saved/);
    assert.match(src, /btnToggleLlmSettings/);
    assert.match(src, /Anti-Replay-OK/);
    assert.match(src, /toggleLlmSettingsExpanded/);
  });
});
