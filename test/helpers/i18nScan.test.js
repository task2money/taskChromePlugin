'use strict';

/**
 * 回归：loadContentScriptMessageTables 只认 content_scripts#0 实际注入的文案包。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ROOT,
  loadContentScriptMessageTables,
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
