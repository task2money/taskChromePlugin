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
  it('cs0 注入 popup 文案包后 paDeliverAgain* 可取词', () => {
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

  it('manifest content_scripts#0 注入的脚本都存在且含 popup 文案包', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const cs0 = manifest.content_scripts[0].js;
    for (const rel of cs0) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} 不存在`);
    }
    assert.ok(cs0.includes('lib/i18n-popup-messages.js'));
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

  it('panel.html 未注入侧栏建议贴文案包 → 其表中无 agentSuggestionsTab', () => {
    // 这条差异是本门禁的存在理由：全量表里有该键，但 panel 页面脚本一旦取词
    // 它就会渲染裸 key——旧门禁用全量表验不出。
    const panelTables = loadPageInjectedMessageTables('panel/panel.html');
    assert.equal(panelTables['zh-CN'].agentSuggestionsTab, undefined);
    assert.equal(panelTables.en.agentSuggestionsTab, undefined);
    const sideTables = loadPageInjectedMessageTables('sidepanel/sidepanel.html');
    assert.equal(sideTables['zh-CN'].agentSuggestionsTab, '网页优化');
    assert.equal(sideTables.en.agentSuggestionsTab, 'Page optimization');
  });

  it('侧栏与弹窗都注入 popup 文案包，且注入脚本文件存在', () => {
    for (const html of ['popup/popup.html', 'sidepanel/sidepanel.html']) {
      const scripts = pageScriptsFromHtml(html);
      assert.ok(scripts.includes('lib/i18n-popup-messages.js'), `${html} 未注入 popup 文案包`);
      for (const rel of scripts) {
        assert.ok(fs.existsSync(path.join(ROOT, rel)), `${html} 注入的 ${rel} 不存在`);
      }
    }
  });
});
