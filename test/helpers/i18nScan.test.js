'use strict';

/**
 * 回归：loadContentScriptMessageTables 只认 content_scripts#0 实际注入的文案包；
 * loadPageInjectedMessageTables 只认扩展页 HTML 实际注入的文案包（OPT-20261007-009）。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ROOT,
  loadContentScriptMessageTables,
  loadPageInjectedMessageTables,
  pageScriptsFromHtml,
  collectTxKeys,
  checkTxKeys,
} = require('./i18nScan.js');

describe('i18nScan loadContentScriptMessageTables', () => {
  it('cs0 注入包含 i18n-llm-route 时 paDeliverAgain* 可取词', () => {
    const tables = loadContentScriptMessageTables();
    assert.equal(typeof tables['zh-CN'].paDeliverAgainAll, 'string');
    assert.equal(typeof tables.en.paDeliverAgainAll, 'string');
    assert.match(tables['zh-CN'].paDeliverAgainAll, /\{name\}/);
    assert.notEqual(tables.en.paDeliverAgainAll, tables['zh-CN'].paDeliverAgainAll);
  });

  it('deliver 脚本 tx 键在 cs0 表中齐备', () => {
    const tables = loadContentScriptMessageTables();
    const rel = 'content/float-page-advisor-deliver.js';
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(collectTxKeys(src).includes('paDeliverAgainAll'));
    assert.deepEqual(checkTxKeys(rel, src, tables), []);
  });

  it('manifest content_scripts#0 含 i18n-llm-route.js', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const cs0 = manifest.content_scripts[0].js;
    assert.ok(cs0.includes('lib/i18n-llm-route.js'));
  });
});

describe('i18nScan loadPageInjectedMessageTables（扩展页按入口注入）', () => {
  it('pageScriptsFromHtml 归一化 ../ 相对路径', () => {
    const scripts = pageScriptsFromHtml('panel/panel.html');
    assert.ok(scripts.includes('lib/i18n.js'));
    assert.ok(scripts.includes('lib/i18n-ui-messages.js'));
    assert.ok(scripts.includes('lib/i18n-tx.js'));
    assert.ok(!scripts.some((rel) => rel.startsWith('../')), '脚本路径未归一化');
  });

  it('panel.html 未注入 i18n-llm-route → 其表中无 paLlmRouteLegend', () => {
    // 这条差异是本门禁的存在理由：全量表里 paLlmRouteLegend 有键，
    // 但 panel 页面脚本一旦取词它就会渲染裸 key——旧门禁用全量表验不出。
    const panelTables = loadPageInjectedMessageTables('panel/panel.html');
    assert.equal(panelTables['zh-CN'].paLlmRouteLegend, undefined);
    assert.equal(panelTables.en.paLlmRouteLegend, undefined);
  });

  it('popup.html 注入了 i18n-llm-route → 其表可取 paLlmRouteLegend', () => {
    const popupTables = loadPageInjectedMessageTables('popup/popup.html');
    assert.equal(typeof popupTables['zh-CN'].paLlmRouteLegend, 'string');
    assert.equal(typeof popupTables.en.paLlmRouteLegend, 'string');
  });
});
