'use strict';

/**
 * 账本导出入口（OPT-20261015-022）。
 *
 * 「直连我的 Key」的记录只在本机，导出是用户能拿出证据的唯一出口；因此这里既钉
 * 行为（导出内容与文件名），也钉 UI 契约（popup 里的按钮与绑定还在）——后者是源码
 * 契约，按钮被删或被改 id 时它会红，而不是等用户点不动才发现。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Ledger = require('../lib/llm-call-ledger.js');

const ROOT = path.join(__dirname, '..');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
const POPUP_LLM_JS = fs.readFileSync(path.join(ROOT, 'popup', 'popup-llm-ledger.js'), 'utf8');
/** 去掉注释后的源码：负向断言只应命中真正的代码，注释里提到 chrome.storage 不算。 */
const POPUP_LLM_CODE = POPUP_LLM_JS
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

function memoryStorage() {
  let data = {};
  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
      return out;
    },
    async set(obj) { data = { ...data, ...obj }; },
  };
}

describe('账本导出：popup 入口与绑定', () => {
  it('popup.html 有导出按钮，文案走 i18n', () => {
    assert.match(
      POPUP_HTML,
      /<button[^>]*id="btnExportLlmCallLedger"[^>]*>.*data-i18n="paLlmLedgerExport"/s,
      '导出按钮缺失或未挂 i18n 文案',
    );
    assert.match(POPUP_HTML, /data-testid="btn-export-llm-call-ledger"/);
    // popup-llm-ledger.js 必须真的被 popup 页面加载，否则按钮点了没反应。
    assert.match(POPUP_HTML, /<script src="popup-llm-ledger\.js"><\/script>/);
    // 账本脚本必须在 popup 侧真实加载，否则按钮点了只会报「保存失败」。
    assert.match(POPUP_HTML, /<script src="\.\.\/lib\/llm-call-ledger\.js"><\/script>/);
  });

  it('按钮绑定到导出处理函数，且导出走账本模块（不自己拼 storage key）', () => {
    assert.match(POPUP_LLM_JS, /#btnExportLlmCallLedger/);
    assert.match(POPUP_LLM_JS, /function exportLedger\(\)/);
    assert.match(POPUP_LLM_JS, /exportLedger\(\)\.catch/);
    assert.match(POPUP_LLM_JS, /typeof PageAdvisorLLMLedger !== 'undefined'/);
    assert.match(POPUP_LLM_JS, /ledger\.exportJSON\(\)/);
    assert.match(POPUP_LLM_JS, /ledger\.exportFilename\(\)/);
    // 不自己拼 storage key：账目字段白名单只在账本模块里，绕过去就会漏 Key/正文。
    assert.doesNotMatch(POPUP_LLM_CODE, /chrome\.storage/);
    // 下载与释放成对：只 createObjectURL 不 revoke 会在长会话里泄漏 blob。
    assert.match(POPUP_LLM_JS, /URL\.createObjectURL/);
    assert.match(POPUP_LLM_JS, /URL\.revokeObjectURL/);
  });

  it('本机记录可删：清空按钮存在且绑定到账本 clearCalls（有导出无清空 = 用户处置不了自己的日志）', () => {
    assert.match(
      POPUP_HTML,
      /<button[^>]*id="btnClearLlmCallLedger"[^>]*>.*data-i18n="paLlmLedgerClear"/s,
      '清空按钮缺失或未挂 i18n 文案',
    );
    assert.match(POPUP_LLM_JS, /#btnClearLlmCallLedger/);
    assert.match(POPUP_LLM_JS, /function clearLedger\(\)/);
    assert.match(POPUP_LLM_JS, /clearLedger\(\)\.catch/);
    assert.match(POPUP_LLM_JS, /ledger\.clearCalls\(\)/);
  });
});

describe('账本导出：内容口径', () => {
  it('文件名按导出当天（YYYY-MM-DD）', () => {
    assert.equal(
      Ledger.exportFilename(new Date('2026-10-16T23:59:59Z')),
      'llm-call-ledger-2026-10-16.json',
    );
  });

  it('导出是带 BOM 的合法 JSON，且逐条只含白名单字段', async () => {
    const storage = memoryStorage();
    await Ledger.recordCall(
      {
        source: 'direct',
        baseUrl: 'https://api.deepseek.com/v1?api_key=sk-leak-check',
        model: 'deepseek-chat',
        ok: true,
        status: 200,
        durationMs: 900,
        responseText: JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 2 } }),
      },
      { storage },
    );

    const text = await Ledger.exportJSON({ storage });
    assert.ok(text.startsWith('﻿'), '缺 BOM，中文在表格工具里会乱码');
    const parsed = JSON.parse(text.slice(1));
    assert.equal(parsed.entries.length, 1);
    const keys = Object.keys(parsed.entries[0]).sort();
    assert.deepEqual(
      keys,
      ['at', 'durationMs', 'host', 'id', 'model', 'ok', 'source', 'status', 'tokens'],
      '账目字段被增删：新增字段必须先过白名单，避免 Key/正文被顺手带出去',
    );
    assert.doesNotMatch(text, /sk-leak-check/);
  });
});
