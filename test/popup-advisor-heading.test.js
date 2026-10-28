'use strict';

/**
 * Popup 网页优化设置区：只有工作空间；快捷键说明与拾取区键位主张互不越界。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const uiMessages = require('../lib/i18n-popup-messages.js');

function popupHtml() {
  return fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
}

function workspaceSection() {
  const html = popupHtml();
  const m = html.match(/id="pageAdvisorWorkspaceSection"[\s\S]*?<\/section>/);
  assert.ok(m, '缺少 pageAdvisorWorkspaceSection');
  return m[0];
}

function shortcutsSection() {
  return popupHtml().match(/<section id="shortcutsSection"[\s\S]*?<\/section>/)[0];
}

function kbdText(id) {
  const m = popupHtml().match(new RegExp(`<kbd id="${id}"[^>]*>([^<]*)</kbd>`));
  return m ? m[1].trim() : '';
}

describe('Popup 网页优化设置区标题与说明', () => {
  it('不再渲染旧调用方式 / 提示词 Skill / 独立默认工作空间区块', () => {
    const html = popupHtml();
    assert.doesNotMatch(html, /id="pageAdvisorLlmSection"/);
    assert.doesNotMatch(html, /id="pageAdvisorSkillSection"/);
    assert.doesNotMatch(html, /id="pageAdvisorDefaultsSection"/);
    assert.doesNotMatch(html, /id="popupDefaultWorkspace"/);
    assert.doesNotMatch(html, /id="popupDefaultProjects"/);
    assert.doesNotMatch(html, /popup-defaults\.js/);
  });

  it('工作空间区标题、网页设置外链与 Alt+Z 提示', () => {
    const section = workspaceSection();
    assert.match(section, /data-i18n="paWorkspaceSectionTitle"/);
    assert.match(section, /data-testid="popup-page-advisor-settings"/);
    assert.match(section, /id="popupPageAdvisorWorkspace"/);
    assert.match(section, /data-i18n="paAltZHintShort"/);
    assert.match(section, /Alt\+Z/);
    assert.match(section, /Alt\+Shift\+Z/);
    assert.doesNotMatch(section, /Alt\+X(?!\w)/);
  });

  it('paAltZHintShort 中英文都主张两个采集键，且不主张 Alt+X', () => {
    for (const locale of ['zh', 'en']) {
      const hint = uiMessages[locale].paAltZHintShort;
      assert.match(hint, /Alt\+Z/, `${locale} 应说明 Alt+Z`);
      assert.match(hint, /Alt\+Shift\+Z/, `${locale} 应说明 Alt+Shift+Z`);
      assert.doesNotMatch(hint, /Alt\+X(?!\w)/, `${locale} 不得主张拾取键 Alt+X`);
    }
  });
});

/**
 * OPT-20260921-029：快捷键说明有「!」details 与底部「快捷键」两处入口。
 */
describe('Popup 快捷键双入口不矛盾（OPT-20260921-029）', () => {
  it('工作空间区只主张 Alt+Z / Alt+Shift+Z，不主张拾取键 Alt+X', () => {
    assert.match(workspaceSection(), /paAltZHintShort/);
    assert.doesNotMatch(workspaceSection(), /Alt\+X(?!\w)/);
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

  it('两个区块各不越界：设置区不出现 Alt+X，快捷键区不出现 Alt+Z', () => {
    assert.doesNotMatch(workspaceSection(), /Alt\+X/);
    assert.doesNotMatch(shortcutsSection(), /Alt\+Z/);
  });
});
